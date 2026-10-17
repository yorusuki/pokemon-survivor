'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../index');
const { clientIP, createLimiter, supportedRuntime, validateMember, validateSignal, validateIceServers, consumeBudget, assertRuntimeRole } = require('../security');
const { grantRuntime } = require('../bootstrap');
const secret = 'test-proxy-key-for-local-tests-only-12345';
const root = path.resolve(__dirname, '../..');

test('代理來源需驗證 secret；不信任客戶端自行宣告的 CF/XFF，IPv6 正規化', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'cf-connecting-ip': '192.0.2.55', 'x-forwarded-for': '192.0.2.56' } };
  assert.equal(clientIP(req, ''), '127.0.0.1');
  assert.throws(() => clientIP(req, secret), { code: 'invalid-proxy' });
  req.headers['x-ps-proxy-token'] = 'wrong';
  assert.throws(() => clientIP(req, secret), { code: 'invalid-proxy' });
  req.headers['x-ps-proxy-token'] = secret; req.headers['x-ps-client-ip'] = '2001:0db8:0:0:0:0:0:1';
  assert.equal(clientIP(req, secret), '[2001:db8::1]');
  req.headers['x-ps-client-ip'] = '192.0.2.1, 192.0.2.2';
  assert.throws(() => clientIP(req, secret));
});

test('不同可信代理訪客不共用登入額度；偽造 header 不會繞過', async () => {
  const server = createApp({ query: async () => ({ rows: [] }) }, { origin: 'https://game.example.com', proxySecret: secret });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const post = (ip, token = secret) => fetch('http://127.0.0.1:' + server.address().port + '/api/auth/login', {
      method: 'POST', headers: { Origin: 'https://game.example.com', 'Content-Type': 'application/json', 'X-PS-Proxy-Token': token, 'X-PS-Client-IP': ip }, body: JSON.stringify({ name: 'x', password: 'x' })
    });
    for (let i=0;i<30;i++) { const r = await post('192.0.2.1'); assert.equal(r.status,400); await r.text(); }
    let r = await post('192.0.2.1'); assert.equal(r.status,429); await r.text();
    r = await post('192.0.2.2'); assert.equal(r.status,400); await r.text();
    r = await post('192.0.2.3','forged'); assert.equal(r.status,403); await r.text();
  } finally { await new Promise(r => server.close(r)); }
});

test('同時處理請求達上限時快速拒絕，不繼續堆積資料庫等待工作', async () => {
  let release,started;
  const entered=new Promise(r=>{started=r;});
  const blocked=new Promise(r=>{release=r;});
  const server=createApp({query:async()=>{started();await blocked;return {rows:[]};}},{origin:'http://localhost:8080',maxInFlight:1});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/api/health';
    const first=fetch(url);await entered;
    const second=await fetch(url);assert.equal(second.status,503);assert.equal((await second.json()).error,'server-busy');
    release();const r=await first;assert.equal(r.status,200);await r.text();
  } finally {release();await new Promise(r=>server.close(r));}
});

test('限流儲存有上限；房間成員拒絕 UID、HTML 名稱及不合法 shiny', () => {
  for(const version of ['22.22.1','24.0.0','26.5.0','23.1.0'])assert.equal(supportedRuntime(version),false);
  for(const version of ['22.23.2','22.23.3','24.18.1','26.5.1'])assert.equal(supportedRuntime(version),true);
  const limiter = createLimiter(2);
  limiter.take('a',1); limiter.take('b',1);
  assert.throws(() => limiter.take('a',1), { code:'too-many-requests' });
  assert.throws(() => limiter.take('c',1), { code:'server-busy' });
  const good = { name:'訓練家甲',dex:1,shiny:false,at:42 };
  assert.deepEqual(validateMember(good),good);
  for (const patch of [{uid:'"><img src=x>'},{name:'<img src=x>'},{shiny:'false'},{constructor:{}}]) assert.throws(() => validateMember({...good,...patch}));
  assert.throws(() => validateSignal({sdp:{}},true));
  assert.throws(() => validateSignal({sdp:{type:'answer',sdp:'v=0'}},true));
  validateSignal({sdp:{type:'offer',sdp:'v=0'}},true);
  validateSignal({c:{candidate:'candidate:fixture',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'test'}},false);
  assert.throws(() => validateIceServers([{urls:'https://evil.example'}]),{code:'turn-provider-error'});
  assert.throws(() => validateIceServers([{urls:'turn:turn.cloudflare.com:3478'}]),{code:'turn-provider-error'});
  assert.deepEqual(validateIceServers([{urls:'turns:turn.cloudflare.com:5349?transport=tcp',username:'fixture',credential:'short-lived'}])[0].urls,['turns:turn.cloudflare.com:5349?transport=tcp']);
});

test('資料庫 runtime 可存取應用資料，但不可建表、刪表或取得超級使用者權限', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(root,'server/schema.sql'),'utf8'));
    await grantRuntime(db,'local-test-database-password-over-32-chars');
    const r = (await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='pokesurvivor_app'")).rows[0];
    assert.ok(Object.values(r).every(v=>v===false));
    await db.query('SET ROLE pokesurvivor_app');
    await assertRuntimeRole(db);
    await db.query("INSERT INTO users(id,login,display_name,password_hash) VALUES('role-test','role-test','RoleTest','fixture')");
    assert.equal((await db.query('SELECT id FROM users')).rows.length,1);
    await assert.rejects(db.query('CREATE TABLE public.should_not_exist(id text)'));
    await assert.rejects(db.query('DROP TABLE users CASCADE'));
    await assert.rejects(db.query('ALTER ROLE pokesurvivor_app SUPERUSER'));
    await db.query('RESET ROLE');
    await assert.rejects(assertRuntimeRole(db),/權限過大/);
    await grantRuntime(db,"quote-test'; DROP TABLE users; -- fixture password");
    assert.equal((await db.query('SELECT id FROM users')).rows.length,1);
    await db.query('CREATE TABLE public.unsafe_owned_fixture(id text)');
    await db.query('ALTER TABLE public.unsafe_owned_fixture OWNER TO pokesurvivor_app');
    await assert.rejects(grantRuntime(db,'local-test-database-password-over-32-chars'),/不可擁有/);
    await db.query('SET ROLE pokesurvivor_app');
    await assert.rejects(assertRuntimeRole(db),/權限過大/);
  } finally { await db.close(); }
});

test('全站配額以 SQL 原子計數，重建 limiter 不會重設；到期後可重新使用', async () => {
  const db=new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(root,'server/schema.sql'),'utf8'));
    await consumeBudget(db,'turn',2); await consumeBudget(db,'turn',2);
    await assert.rejects(consumeBudget(db,'turn',2),{code:'too-many-requests'});
    createLimiter();
    await assert.rejects(consumeBudget(db,'turn',2),{code:'too-many-requests'});
    await db.query("UPDATE security_limits SET reset_at=now()-interval '1 minute' WHERE id='turn'");
    await consumeBudget(db,'turn',2);
    assert.equal((await db.query("SELECT used FROM security_limits WHERE id='turn'")).rows[0].used,1);
  } finally {await db.close();}
});

test('API 拒絕房間 UID 注入及存檔名稱 HTML；合法更新、房間配額保持正常', async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(root,'server/schema.sql'),'utf8'));
  let tail = Promise.resolve();
  const lock = async () => { let release; const prev=tail; tail=new Promise(r=>{release=r;}); await prev; return release; };
  const query = async (s,a) => { const r=await db.query(s,a);return {...r,rowCount:r.rows.length||r.affectedRows||0}; };
  const pool = {
    async query(s,a) { const release=await lock(); try{return await query(s,a);}finally{release();} },
    async connect() { const release=await lock(); return {query,release}; }
  };
  const origin='http://localhost:8080', server=createApp(pool,{origin});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let cookie='';
  const post=async(route,body)=>{
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,body:await r.json()};
  };
  try {
    const uid=(await post('auth/register',{name:'SecurityTester',password:'local-test-password'})).body.user.uid;
    assert.equal((await post('documents',{op:'query',path:'__proto__',filters:[],limit:10})).status,400);
    const member={name:'SecurityTester',dex:1,shiny:false};
    const create=(id,m=member)=>post('rooms',{op:'set',path:'rooms/'+id,data:{host:uid,open:true,m:{[uid]:m}}});
    assert.equal((await create('securityroom1',{...member,uid:'"><img src=x>'})).status,400);
    assert.equal((await create('securityroom1')).status,200);
    assert.equal((await post('rooms',{op:'update',path:'rooms/securityroom1/m/'+uid,data:{uid:'fake'}})).status,400);
    assert.equal((await post('rooms',{op:'update',path:'rooms/securityroom1/m/'+uid,data:{dex:25}})).status,200);
    assert.equal((await create('securityroom2')).status,200);
    assert.equal((await create('securityroom3')).status,429);
    const writes=[{op:'set',path:'saves/'+uid,data:{v:3,save:{name:'<img src=x>',coins:500}}}];
    assert.equal((await post('documents',{op:'commit',reads:[],writes})).status,403);
    writes[0].data.save.name='訓練家甲';
    assert.equal((await post('documents',{op:'commit',reads:[],writes})).status,200);
    writes[0].data.save.stats={runs:'<img src=x>'};
    assert.equal((await post('documents',{op:'commit',reads:[],writes})).status,403);
    for(let i=0;i<22;i++)assert.equal((await post('auth/login',{name:'SecurityTester',password:'local-test-password'})).status,200);
    assert.equal(Number((await db.query('SELECT count(*) FROM sessions WHERE user_id=$1',[uid])).rows[0].count),20);
  } finally {await new Promise(r=>server.close(r));await db.close();}
});

function protocol() {
  const c={G:{},TextEncoder};vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root,'js/net/protocol.js'),'utf8'),c);
  return c.G.NetProtocol;
}
test('WebRTC 協定接受正常戰鬥狀態，拒絕畸形、大量、過深、原型欄位與結束統計 HTML', () => {
  const p=protocol(), a='a'.repeat(32), b='b'.repeat(32);
  const state=[0,0,0,1,100,100,0,'tackle',1,10,0,1,0,0,0];
  const client={k:'f',p:state,ev:[['h',1,10,'#fff',0,0,0]]};
  const host={k:'f',t:1,lv:1,xp:1,xn:10,ki:0,bo:0,co:0,tk:[0,0],p:{[a]:state},e:[[1,0,0,100,0,0,0]],ev:[['ov',{t:1,ki:0,bo:0,co:0,lv:1,t1:0,t10:0}]]};
  assert.ok(p.parse(JSON.stringify(client),false)); assert.ok(p.parse(JSON.stringify(host),true));
  const start={k:'start',seed:1,host:a,members:[{uid:a,name:'Host',dex:1,shiny:false},{uid:b,name:'Guest',dex:25,shiny:false}]};
  assert.ok(p.message(start,true));assert.equal(p.message(start,false),false);
  for(const bad of [{...client,p:{}},{...client,ev:Array(1025).fill(['lp'])},{...host,co:'<img src=x>'},{...host,ev:[['ov',{ki:'<img src=x>'}]]}])assert.equal(p.parse(JSON.stringify(bad),bad.p&&Array.isArray(bad.p)?false:true),null);
  assert.equal(p.parse('{"k":"f","__proto__":{}}',true),null);
  assert.equal(p.parse(' '.repeat(p.MAX_BYTES+1),true),null);
  assert.equal(p.message({...client,p:[...state.slice(0,14),Infinity]},false),false);
});

test('名稱 DOM 輸出保留 HTML 為文字，不會把存檔名稱插入 innerHTML', () => {
  function element(){return {innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},append(...children){this.children=children;}};}
  const elements=new Map(); const el=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const c={G:{DB:{save:{coins:0,tickets:{t1:0,t10:0}},guest:false,user:'<img src=x onerror=alert(1)>',syncState:'ok'},Icons:{html:()=>'<svg></svg>'}},document:{getElementById:el,createElement:element},setTimeout,clearTimeout};
  c.window=c;
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui.js'),'utf8'),c);
  c.G.UI.refreshCoins();
  assert.equal(el('user-pill').innerHTML,'<svg></svg>');
  assert.equal(el('user-pill').children[1].textContent,c.G.DB.user);
});

test('真實 Net 模組拒絕訪客 start／訊息洪水，合法房主 start 與先到的 ICE 仍可處理', async () => {
  const a='a'.repeat(32), b='b'.repeat(32);
  async function fixture(host) {
    const connections=[], received=[]; let queued;
    const channel=()=>({readyState:'open',closed:false,close(){this.closed=true;},send(){}});
    class Peer {
      constructor(){connections.push(this);this.ice=[];}
      createDataChannel(){return this.channel=channel();}
      async createOffer(){return {type:'offer',sdp:'v=0'};}
      async createAnswer(){return {type:'answer',sdp:'v=0'};}
      async setLocalDescription(d){this.localDescription={toJSON:()=>d};}
      async setRemoteDescription(d){this.remoteDescription=d;}
      async addIceCandidate(c){this.ice.push(c);}
      close(){this.closed=true;}
    }
    const rtdb={ref:()=>({on(event,fn){queued=fn;},off(){},push:async()=>{}})};
    const c={G:{DB:{fb:{uid:host?a:b,rtdb}},Backend:{iceServers:async()=>[]}},TextEncoder,RTCPeerConnection:Peer,performance:{now:()=>0},setTimeout:()=>0,clearTimeout(){},console:{info(){},warn(){},error(){}}};
    vm.createContext(c);
    for(const f of ['js/net/protocol.js','js/net/net.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),c);
    c.G.Net.on((u,m)=>received.push(m));c.G.Net.open('fixture-room',host,a);c.G.Net.syncMembers([a,b]);
    await new Promise(setImmediate);
    return {G:c.G,connections,received,channel,signal:async(sig)=>{queued({val:()=>JSON.stringify({f:a,sig}),ref:{remove:async()=>{}}});await new Promise(setImmediate);}};
  }
  const state=[0,0,0,1,100,100,0,'tackle',1,10,0,1,0,0,0];
  const frame=JSON.stringify({k:'f',p:state,ev:[]});
  const start={k:'start',seed:1,host:a,members:[{uid:a,name:'Host',dex:1,shiny:false},{uid:b,name:'Guest',dex:25,shiny:false}]};
  let f=await fixture(true);let dc=f.connections[0].channel;dc.onopen();
  dc.onmessage({data:frame});assert.equal(f.received.length,1);
  dc.onmessage({data:JSON.stringify(start)});assert.equal(f.received.length,1);assert.equal(dc.closed,true);f.G.Net.close();
  f=await fixture(true);dc=f.connections[0].channel;dc.onopen();
  for(let i=0;i<121;i++)dc.onmessage({data:frame});
  assert.equal(f.received.length,120);assert.equal(dc.closed,true);f.G.Net.close();
  f=await fixture(false);
  await f.signal({c:{candidate:'candidate:fixture',sdpMid:'0',sdpMLineIndex:0}});
  await f.signal({sdp:{type:'offer',sdp:'v=0'}});
  const pc=f.connections[0];assert.equal(pc.ice.length,1);
  dc=f.channel();pc.ondatachannel({channel:dc});dc.onopen();
  dc.onmessage({data:JSON.stringify(start)});assert.equal(f.received.length,1);
  dc.onmessage({data:JSON.stringify({...start,host:b})});assert.equal(f.received.length,1);
  f.G.Net.close();
});
