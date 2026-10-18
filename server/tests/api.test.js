'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createApp, hashPassword, verifyPassword } = require('../index');
const { address, timestamps } = require('../store');
let db, server, base, providerCalls = [];
const origin = 'http://localhost:8080';
const stamp = { __serverTimestamp: true };
const password = 'test-password-123';
function client() {
  let cookie = '';
  return async (route, data = {}, opts = {}) => {
    const r = await fetch(base + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, ...opts.headers }, body: JSON.stringify(data) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}
const get = (c, p) => c('documents', { op: 'get', path: p });
const commit = (c, writes, reads = []) => c('documents', { op: 'commit', writes, reads });
const set = (c, path, data) => commit(c, [{ op: 'set', path, data }]);
async function register(c, name) {
  const r = await c('auth/register', { name, password }); assert.equal(r.status, 200); return r.body.user.uid;
}
before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));
  // PGlite 使用 PostgreSQL WASM 引擎；單一測試連線，保留真正 SQL／交易。
  const query = async (sql, args) => { const r = await db.query(sql, args); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
  let tail = Promise.resolve();
  const lock = async () => { let release; const previous = tail; tail = new Promise(r => { release = r; }); await previous; return release; };
  const pool = {
    async query(sql, args) { const release = await lock(); try { return await query(sql, args); } finally { release(); } },
    async connect() { const release = await lock(); return { query, release }; }
  };
  server = createApp(pool, { origin, turnFetch: async (url, options) => {
    providerCalls.push({ url, options });
    return { ok: true, json: async () => ({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'short-lived-user', credential: 'short-lived-fixture' }] }) };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });

test('密碼採 scrypt，salt 不同；錯誤密碼驗證失敗', async () => {
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b); assert.equal(await verifyPassword(password, a), true); assert.equal(await verifyPassword('wrong', a), false);
});
test('路徑與時間戳拒絕不可信欄位', () => {
  assert.throws(() => address('saves/../../users'));
  assert.throws(() => address('users/test'));
  assert.throws(() => timestamps(JSON.parse('{"__proto__":{}}')));
  assert.deepEqual(timestamps({ at: stamp }, 42), { at: 42 });
});
test('註冊、登入、Cookie 與 CSRF 邊界', async () => {
  const a = client(); const uid = await register(a, 'TrainerA');
  assert.ok(uid); assert.equal((await a('auth/session')).body.user.uid, uid);
  assert.equal((await client()('auth/register', { name: 'TrainerA', password })).status, 409);
  assert.equal((await a('auth/logout')).status, 200);
  assert.equal((await a('auth/session')).body.user, null);
  assert.equal((await a('auth/login', { name: 'TrainerA', password: 'incorrect-pass' })).status, 401);
  assert.equal((await a('auth/login', { name: 'TrainerA', password })).status, 200);
  assert.equal((await a('auth/session', {}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await client()('documents', { op: 'get', path: 'saves/' + uid })).status, 401);
});
test('存檔隔離、交易衝突、禁止更改封鎖與非法金幣', async () => {
  const a = client(), b = client(), uid = await register(a, 'SaveOwner'); await register(b, 'OtherOwner');
  const doc = { save: { coins: 500, tickets: { t1: 0, t10: 0 } }, v: 3, updatedAt: stamp };
  assert.equal((await set(a, 'saves/' + uid, doc)).status, 200);
  assert.equal((await get(b, 'saves/' + uid)).status, 403);
  assert.equal((await set(b, 'saves/' + uid, doc)).status, 403);
  assert.equal((await set(a, 'saves/' + uid, { ...doc, ban: true })).status, 403);
  assert.equal((await set(a, 'saves/' + uid, { ...doc, save: { coins: -1 } })).status, 403);
  const snap = (await get(a, 'saves/' + uid)).body;
  await set(a, 'saves/' + uid, doc);
  assert.equal((await commit(a, [{ op: 'set', path: 'saves/' + uid, data: doc }], [{ path: snap.path, revision: snap.revision }])).status, 409);
});
test('暱稱保留與好友申請只能由接收者接受', async () => {
  const a = client(), b = client(), c = client();
  const u = await register(a, 'FriendA'), v = await register(b, 'FriendB'); await register(c, 'FriendC');
  assert.equal((await commit(a, [{ op: 'set', path: 'names/frienda', data: { uid: u } }, { op: 'set', path: 'profiles/' + u, data: { name: 'FriendA', lower: 'frienda', at: stamp } }])).status, 200);
  assert.equal((await set(b, 'names/frienda', { uid: v })).status, 403);
  const id = [u, v].sort().join('_'), friend = { users: [u, v].sort(), from: u, to: v, status: 'pending', names: {}, at: stamp };
  assert.equal((await set(a, 'friendships/' + id, friend)).status, 200);
  assert.equal((await set(a, 'friendships/' + id, { ...friend, status: 'ok' })).status, 403);
  assert.equal((await get(c, 'friendships/' + id)).status, 403);
  assert.equal((await set(b, 'friendships/' + id, { ...friend, status: 'ok' })).status, 200);
  const q = await a('documents', { op: 'query', path: 'friendships', filters: [['users', 'array-contains', u]], limit: 100 });
  assert.equal(q.status, 200); assert.equal(q.body.docs.length, 1);
});
test('房間限制 4 人；協商訊息禁止冒名與跨房讀取', async () => {
  const clients = [], ids = [];
  for (let i = 0; i < 5; i++) { const c = client(); clients.push(c); ids.push(await register(c, 'RoomUser' + i)); }
  const [a, b, , , outsider] = clients, room = 'rooms/abcdef123456';
  const member = i => ({ name: 'RoomUser' + i, dex: 1, shiny: false, at: stamp });
  assert.equal((await a('rooms', { op: 'set', path: room, data: { host: ids[0], open: true, at: stamp, m: { [ids[0]]: member(0) } } })).status, 200);
  const joined=await Promise.all([1,2,3].map(i=>clients[i]('rooms',{op:'set',path:room+'/m/'+ids[i],data:member(i)})));
  joined.forEach(r=>assert.equal(r.status,200));
  assert.equal((await outsider('rooms', { op: 'set', path: room + '/m/' + ids[4], data: member(4) })).status, 409);
  assert.equal((await outsider('rooms', { op: 'get', path: room + '/m' })).status, 403);
  const p = room + '/q/' + ids[1] + '/signal001';
  assert.equal((await a('rooms', { op: 'set', path: p, data: JSON.stringify({ f: ids[1], sig: { sdp: {} } }) })).status, 403);
  assert.equal((await a('rooms', { op: 'set', path: p, data: JSON.stringify({ f: ids[0], sig: { sdp: { type: 'offer', sdp: 'v=0\r\n' } } }) })).status, 200);
  assert.equal((await a('rooms', { op: 'get', path: room + '/q/' + ids[1] })).status, 403);
  assert.equal(Object.keys((await b('rooms', { op: 'get', path: room + '/q/' + ids[1] })).body.data).length, 1);
});
test('排行榜時長檢查、摘要由伺服器重建、禁止偽造成績', async () => {
  const a = client(), uid = await register(a, 'RankOwner');
  await set(a, 'runs/' + uid, { startedAt: stamp, mode: 's' });
  const row = { t: 10, uids: [uid], names: ['RankOwner'], dex: [1], shiny: [false], lv: 2, kills: 5, at: stamp };
  const p = 'lb/s_all/e/' + uid;
  assert.equal((await set(a, p, { ...row, t: 3600 })).status, 403);
  assert.equal((await set(a, p, row)).status, 200);
  assert.equal((await get(a, 'lbs/s_all')).body.data.top[uid].t, 10);
  await set(a, 'lbs/s_all', { top: { forged: { t: 9999 } } });
  assert.equal((await get(a, 'lbs/s_all')).body.data.top.forged, undefined);
  assert.equal((await a('ranking/count', { board: 's_all', time: 1 })).body.count, 1);
});
test('帳號刪除先驗證密碼；失敗保留存檔，成功清理關聯資料', async () => {
  const a = client(), uid = await register(a, 'DeleteOwner');
  await set(a, 'saves/' + uid, { save: { coins: 1 }, v: 3 });
  assert.equal((await a('auth/delete', { password: 'wrong' })).status, 401);
  assert.equal((await get(a, 'saves/' + uid)).body.data.save.coins, 1);
  assert.equal((await a('auth/delete', { password })).status, 200);
  assert.equal((await a('auth/session')).body.user, null);
  assert.equal((await db.query('SELECT * FROM saves WHERE id=$1', [uid])).rows.length, 0);
});
test('TURN 未設定時明確回傳 STUN 模式，不偽稱已啟用 TURN', async () => {
  const a = client(); await register(a, 'TurnOwner');
  const r = await a('ice-servers'); assert.equal(r.status, 200); assert.equal(r.body.turn, false); assert.ok(r.body.iceServers.length);
});
test('TURN 已設定時僅回傳短期憑證，長期 token 留在後端', async () => {
  const oldKey = process.env.CLOUDFLARE_TURN_KEY_ID, oldToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  process.env.CLOUDFLARE_TURN_KEY_ID = '0123456789abcdef0123456789abcdef';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'test-only-long-lived-fixture';
  try {
    const a = client(); await register(a, 'TurnConfigured');
    const r = await a('ice-servers');
    assert.equal(r.status, 200); assert.equal(r.body.turn, true); assert.ok(r.body.expiresAt > Date.now());
    assert.equal(JSON.stringify(r.body).includes('test-only-long-lived-fixture'), false);
    assert.equal(providerCalls.at(-1).options.headers.Authorization, 'Bearer test-only-long-lived-fixture');
    assert.equal(JSON.parse(providerCalls.at(-1).options.body).ttl, 7200);
    process.env.CLOUDFLARE_TURN_KEY_ID = '';
    assert.equal((await a('ice-servers')).status, 503);
  } finally {
    if (oldKey === undefined) delete process.env.CLOUDFLARE_TURN_KEY_ID; else process.env.CLOUDFLARE_TURN_KEY_ID = oldKey;
    if (oldToken === undefined) delete process.env.CLOUDFLARE_TURN_API_TOKEN; else process.env.CLOUDFLARE_TURN_API_TOKEN = oldToken;
  }
});

test('真正前端資料層：註冊、合併存檔、預約暱稱、建立房間與登出', async () => {
  const root = path.join(__dirname, '../..'), storage = new Map();
  let cookie = '';
  const context = {
    console, TextEncoder, TextDecoder, crypto: crypto.webcrypto, queueMicrotask,
    AbortSignal,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    setInterval: (fn, ms) => setInterval(fn, ms).unref(), clearInterval,
    addEventListener() {}, removeEventListener() {},
    location: { protocol: 'http:', pathname: '/', search: '' },
    navigator: { language: 'zh-TW', languages: ['zh-TW'], onLine: true },
    document: { documentElement: {}, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), get length() { return storage.size; }, key: i => [...storage.keys()][i] },
    CanvasRenderingContext2D: function () {},
    fetch: async (route, opts = {}) => {
      const r = await fetch(base + route, { ...opts, headers: { ...opts.headers, Origin: origin, Cookie: cookie } });
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return r;
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/core/util.js', 'js/core/i18n.js', 'js/data/lang-en.js', 'js/data/lang-zh-TW.js', 'js/data/pokedex.js', 'js/core/backend.js', 'js/core/db.js', 'js/net/social.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const G = context.G;
  assert.equal(await G.DB.ready(), false);
  assert.equal(G.DB.mode, 'cloud');
  const result = await G.DB.register('ClientTrainer', password);
  assert.equal(result.ok, true);
  await G.DB.flush();
  assert.equal(G.DB.syncState, 'ok');
  assert.equal(G.DB.save.coins, 500);
  G.DB.save.coins += 123; G.DB.commit(true); await G.DB.flush();
  const saved = await G.Backend.store.collection('saves').doc(G.DB.fb.uid).get();
  assert.equal(saved.data().save.coins, 623);
  assert.equal(await G.Social.start(), 'ok');
  const friendClient=client(),friendUid=await register(friendClient,'CodeFriend');
  assert.equal((await friendClient('account',{action:'rename',name:'CodeFriend'})).status,200);
  const friendCode=(await friendClient('account',{action:'get'})).body.friendCode;
  assert.equal((await G.Social.request(' '+friendCode.toLowerCase()+' ')).ok,true);
  assert.equal((await G.Social.request(G.Social.account.friendCode)).ok,false);
  assert.equal((await G.Social.request(friendUid)).ok,false);
  const relation=[G.DB.fb.uid,friendUid].sort().join('_');
  assert.equal((await get(friendClient,'friendships/'+relation)).body.data.from,G.DB.fb.uid);
  G.DB.save.partner = 1;
  const room = await G.Social.createRoom(); assert.ok(room.id);
  await G.Social.leaveRoom();
  await G.DB.logout();
  assert.equal(G.DB.loggedIn, false);
});


test('多人診斷需登入、固定列舉、每分鐘限流',async()=>{
 const anon=client(),a=client();
 assert.equal((await anon('network-events',{event:'failed',reason:'timeout',route:'unknown'})).status,401);
 await register(a,'NetLogUser');
 assert.equal((await a('network-events',{event:'arbitrary-secret',reason:'timeout',route:'unknown'})).status,400);
 for(let i=0;i<30;i++)assert.equal((await a('network-events',{event:'connected',reason:'none',route:'direct'})).status,200);
 assert.equal((await a('network-events',{event:'failed',reason:'timeout',route:'unknown'})).status,429);
});

test('寶可夢生存紀錄通過伺服器邊界驗證，拒絕負數、錯誤 ID 與非整數',async()=>{
 const a=client(),uid=await register(a,'SurvivalUser');
 const data={v:3,updatedAt:stamp,save:{name:'SurvivalUser',coins:500,tickets:{t1:0,t10:0},survivalBest:{1:1800}}};
 assert.equal((await set(a,'saves/'+uid,data)).status,200);
 for(const invalid of [{1:-1},{1:1800.5},{1026:1800},{'__bad':1800}]) {
  assert.equal((await set(a,'saves/'+uid,{...data,save:{...data.save,survivalBest:invalid}})).status,403);
 }
});

test('最愛存檔伺服器拒絕超過 100 與不合法欄位，取消標記可保留',async()=>{
 const a=client(),uid=await register(a,'FavoriteUser');
 const data={v:3,updatedAt:stamp,save:{name:'FavoriteUser',coins:500,tickets:{t1:0,t10:0},favorites:{1:{on:true,at:1},2:{on:false,at:2}}}};
 assert.equal((await set(a,'saves/'+uid,data)).status,200);
 const tooMany=Object.fromEntries(Array.from({length:101},(_,i)=>[i+1,{on:true,at:1}]));
 for(const favorites of [tooMany,{0:{on:true,at:1}},{1:{on:'yes',at:1}},{1:{on:true,at:-1}},{1:{on:true,at:1,extra:true}}]) {
  assert.equal((await set(a,'saves/'+uid,{...data,save:{...data.save,favorites}})).status,403);
 }
});

test('招式儲備偏好伺服器驗證布林、圖鑑 ID 與時間戳',async()=>{
 const a=client(),uid=await register(a,'ReserveUser');
 const data={v:3,updatedAt:stamp,save:{name:'ReserveUser',coins:500,tickets:{t1:0,t10:0},moveReserve:{1:{enabled:false,at:1}}}};
 assert.equal((await set(a,'saves/'+uid,data)).status,200);
 for(const moveReserve of [{0:{enabled:true,at:1}},{1026:{enabled:true,at:1}},{1:{enabled:'false',at:1}},{1:{enabled:true,at:-1}},{1:{enabled:true,at:1,extra:1}}]) assert.equal((await set(a,'saves/'+uid,{...data,save:{...data.save,moveReserve}})).status,403);
});
