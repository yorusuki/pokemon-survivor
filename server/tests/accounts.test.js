'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createApp}=require('../index');
const {grantRuntime}=require('../bootstrap');
const DAY=86400000,origin='http://localhost:8080',password='fixture-account-password';
let db,server,base,clock=Date.now(),serial=0;
function client(){let cookie='';return async(route,body={},headers={})=>{
 const r=await fetch(base+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(body)});
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};
};}
async function user(){const c=client(),login='Account'+(++serial);const reg=await c('auth/register',{name:login,password});assert.equal(reg.status,200);const uid=reg.body.user.uid;assert.equal((await c('account',{action:'rename',name:login})).status,200);return {c,uid,login};}
const account=(c,action,extra={})=>c('account',{action,...extra});
const commit=(c,writes)=>c('documents',{op:'commit',reads:[],writes});
before(async()=>{
 db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
 let tail=Promise.resolve();const lock=async()=>{let release;const before=tail;tail=new Promise(r=>release=r);await before;return release;};
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 const pool={async query(sql,args){const release=await lock();try{return await query(sql,args);}finally{release();}},async connect(){const release=await lock();return {query,release};}};
 server=createApp(pool,{origin,accountClock:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});

test('好友代碼需登入、獨立隨機且穩定，不接受 UID／暱稱查詢，私有表不走 documents',async()=>{
 clock=Date.now();assert.equal((await account(client(),'get')).status,401);
 const malformed=await user();for(const action of ['__proto__',{},'constructor'])assert.equal((await malformed.c('account',{action})).status,400);
 const a=await user(),b=await user(),one=await account(a.c,'get'),two=await account(a.c,'get'),other=await account(b.c,'get');
 assert.match(one.body.friendCode,/^PS-[A-F0-9]{20}$/);assert.equal(one.body.friendCode,two.body.friendCode);assert.notEqual(one.body.friendCode,other.body.friendCode);
 const lookup=await account(b.c,'lookup',{code:one.body.friendCode});assert.equal(lookup.body.uid,a.uid);assert.equal(lookup.body.name,a.login);assert.equal(lookup.body.friendCode,undefined);
 for(const code of [a.uid,a.login,'PS-000','PS-'+'0'.repeat(20)])assert.ok([400,404].includes((await account(b.c,'lookup',{code})).status));
 assert.equal((await a.c('documents',{op:'get',path:'account_settings/'+a.uid})).status,400);
 assert.equal((await a.c('account',{action:'rename',name:'DeniedName'},{Origin:'https://bad.example'})).status,403);
});

test('改名保留 UID、登入帳號、好友及存檔；好友顯示投影為最新名稱',async()=>{
 clock=Date.now();const a=await user(),b=await user(),before=(await account(a.c,'get')).body;
 await db.query('INSERT INTO saves(id,data) VALUES($1,$2)',[a.uid,JSON.stringify({v:3,save:{name:a.login,coins:123}})]);
 const id=[a.uid,b.uid].sort().join('_'),friend={users:[a.uid,b.uid],from:a.uid,to:b.uid,status:'pending',names:{[a.uid]:a.login,[b.uid]:b.login},at:clock};
 assert.equal((await commit(a.c,[{op:'set',path:'friendships/'+id,data:friend}])).status,200);
 assert.equal((await commit(b.c,[{op:'update',path:'friendships/'+id,data:{status:'ok'}}])).status,200);
 assert.equal((await account(a.c,'rename',{name:'改名訓練家'})).status,200);
 const after=(await account(a.c,'get')).body;assert.equal(after.friendCode,before.friendCode);assert.equal(after.loginName,a.login.toLowerCase());
 const saved=(await a.c('documents',{op:'get',path:'saves/'+a.uid})).body.data.save;assert.equal(saved.coins,123);assert.equal(saved.name,'改名訓練家');
 const q=await b.c('documents',{op:'query',path:'friendships',filters:[],limit:20});assert.equal(q.body.docs.find(d=>d.path.endsWith(id)).data.names[a.uid],'改名訓練家');
 const one=await b.c('documents',{op:'get',path:'friendships/'+id});assert.equal(one.body.data.names[a.uid],'改名訓練家');
 const login=await client()('auth/login',{name:a.login,password});assert.equal(login.body.user.uid,a.uid);assert.equal(login.body.user.displayName,'改名訓練家');
 assert.equal((await client()('auth/login',{name:'改名訓練家',password})).status,401);
});

test('24 小時精確邊界、原名保留 7 天，無變更不消耗冷卻',async()=>{
 clock=Date.now();const a=await user(),b=await user(),start=clock;
 assert.equal((await account(a.c,'rename',{name:'CooldownA'})).status,200);
 assert.equal((await account(a.c,'rename',{name:'CooldownA'})).status,200);
 clock=start+DAY-1;assert.equal((await account(a.c,'rename',{name:'CooldownB'})).status,429);
 clock=start+DAY;assert.equal((await account(a.c,'rename',{name:'CooldownB'})).status,200);
 assert.equal((await account(b.c,'rename',{name:a.login})).status,409);
 clock=start+7*DAY-1;assert.equal((await account(b.c,'rename',{name:a.login})).status,409);
 clock=start+7*DAY;assert.equal((await account(b.c,'rename',{name:a.login})).status,200);
});

test('大小寫改名亦計冷卻，原擁有者可取回保留名，不能多占活躍暱稱',async()=>{
 clock=Date.now();const a=await user(),start=clock;
 assert.equal((await account(a.c,'rename',{name:a.login.toUpperCase()})).status,200);
 assert.equal((await account(a.c,'rename',{name:'OtherAlias'})).status,429);
 clock=start+DAY;assert.equal((await account(a.c,'rename',{name:'OtherAlias'})).status,200);
 clock+=DAY;assert.equal((await account(a.c,'rename',{name:a.login})).status,200);
 assert.equal((await db.query("SELECT id FROM names WHERE data->>'uid'=$1",[a.uid])).rows.length,1);
});

test('在合作房間內後端拒絕改名，離房後可改，其他帳號的房間不影響',async()=>{
 clock=Date.now();const a=await user();const id='rename_room_test',member={name:a.login,dex:1,shiny:false};
 assert.equal((await a.c('rooms',{op:'set',path:'rooms/'+id,data:{host:a.uid,open:true,m:{[a.uid]:member}}})).status,200);
 assert.equal((await account(a.c,'rename',{name:'RoomBlocked'})).body.error,'rename-in-room');
 assert.equal((await a.c('rooms',{op:'remove',path:'rooms/'+id})).status,200);
 assert.equal((await account(a.c,'rename',{name:'RoomAllowed'})).status,200);
});

test('一般文件 API 無法繞過改名限制，舊存檔不能覆寫最新名字',async()=>{
 clock=Date.now();const a=await user();assert.equal((await account(a.c,'rename',{name:'CanonicalName'})).status,200);
 for(const writes of [
  [{op:'delete',path:'profiles/'+a.uid}],
  [{op:'delete',path:'names/canonicalname'},{op:'set',path:'names/bypass',data:{uid:a.uid}}],
  [{op:'set',path:'profiles/'+a.uid,data:{name:'BypassName',lower:'bypassname'}}]
 ])assert.equal((await commit(a.c,writes)).status,403);
 assert.equal((await commit(a.c,[{op:'set',path:'saves/'+a.uid,data:{v:3,save:{name:a.login,coins:99}}}])).status,200);
 assert.equal((await a.c('documents',{op:'get',path:'saves/'+a.uid})).body.data.save.name,'CanonicalName');
});

test('同名競爭僅一個成功，格式與 Unicode 正規化邊界明確拒絕且不留下部分資料',async()=>{
 clock=Date.now();const a=await user(),b=await user();const both=await Promise.all([account(a.c,'rename',{name:'RaceWinner'}),account(b.c,'rename',{name:'RaceWinner'})]);
 assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
 const c=await user();for(const name of ['<script>','ab','İpek','𠮷'.repeat(9),'bad name'])assert.equal((await account(c.c,'rename',{name})).status,400);
 assert.equal((await account(c.c,'get')).body.name,c.login);
});

test('管理員修改其他帳號的封鎖狀態時仍保留目標玩家的正確暱稱',async()=>{
 clock=Date.now();const owner=await user(),moderator=await user();
 assert.equal((await commit(owner.c,[{op:'set',path:'saves/'+owner.uid,data:{v:3,save:{name:owner.login,coins:99}}}])).status,200);
 const before=process.env.ADMIN_USER_IDS;process.env.ADMIN_USER_IDS=moderator.uid;
 try {
  assert.equal((await commit(moderator.c,[{op:'update',path:'saves/'+owner.uid,data:{ban:true}}])).status,200);
  const saved=(await owner.c('documents',{op:'get',path:'saves/'+owner.uid})).body.data;
  assert.equal(saved.save.name,owner.login);assert.equal(saved.ban,true);
 } finally {if(before===undefined)delete process.env.ADMIN_USER_IDS;else process.env.ADMIN_USER_IDS=before;}
});

test('Google-only 帳號可改暱稱與使用好友代碼，不顯示密碼登入帳號',async()=>{
 clock=Date.now();const a=await user();await db.query('UPDATE users SET password_hash=NULL WHERE id=$1',[a.uid]);
 await db.query('INSERT INTO google_identities(google_sub,user_id) VALUES($1,$2)',['fixture-account-google',a.uid]);
 const result=await account(a.c,'rename',{name:'GoogleAlias'});assert.equal(result.status,200);assert.equal(result.body.loginName,null);assert.match(result.body.friendCode,/^PS-/);
 assert.equal((await a.c('auth/session')).body.user.uid,a.uid);
});

test('改名中途資料庫錯誤會完整回滾，不釋放原名或消耗冷卻',async()=>{
 clock=Date.now();const a=await user();
 await db.exec("CREATE FUNCTION reject_rename_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.display_name='RollbackAlias' THEN RAISE EXCEPTION 'fixture rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_rename_fixture BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_rename_fixture();");
 try {assert.equal((await account(a.c,'rename',{name:'RollbackAlias'})).status,500);}
 finally {await db.exec('DROP TRIGGER reject_rename_fixture ON users; DROP FUNCTION reject_rename_fixture();');}
 const state=(await account(a.c,'get')).body;assert.equal(state.name,a.login);assert.equal(state.nextRenameAt,0);
 assert.equal((await db.query('SELECT 1 FROM names WHERE id=$1',[a.login.toLowerCase()])).rows.length,1);
 assert.equal((await db.query('SELECT 1 FROM names WHERE id=$1',['rollbackalias'])).rows.length,0);
 assert.equal((await db.query('SELECT 1 FROM nickname_holds WHERE user_id=$1',[a.uid])).rows.length,0);
});

test('好友代碼查詢具每帳號限流',async()=>{
 clock=Date.now();const a=await user();for(let i=0;i<20;i++)assert.equal((await account(a.c,'lookup',{code:'PS-'+'0'.repeat(20)})).status,404);
 assert.equal((await account(a.c,'lookup',{code:(await account(a.c,'get')).body.friendCode})).status,429);
});

test('schema 重跑保留舊帳號、代碼與冷卻；runtime 可存取新增私有表，刪帳號會清理',async()=>{
 clock=Date.now();const a=await user();assert.equal((await account(a.c,'rename',{name:'MigrationAlias'})).status,200);const before=(await account(a.c,'get')).body;
 await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));assert.deepEqual((await account(a.c,'get')).body,before);
 await grantRuntime(db,'fixture-runtime-password-more-than-32-characters');
 for(const table of ['account_settings','nickname_holds'])assert.equal((await db.query("SELECT has_table_privilege('pokesurvivor_app',$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[table])).rows[0].allowed,true);
 assert.equal((await a.c('auth/delete',{password})).status,200);
 for(const table of ['account_settings','nickname_holds'])assert.equal((await db.query('SELECT 1 FROM '+table+' WHERE user_id=$1',[a.uid])).rows.length,0);
});

test('從缺少新表的舊 schema 升級保留帳號、存檔及好友原資料',async()=>{
 const legacy=new PGlite(),schema=fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
 try {
  await legacy.exec(schema.split('-- Private account metadata')[0]);
  for(const uid of ['legacy-a','legacy-b'])await legacy.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$1,$1,$2)',[uid,'fixture']);
  const save={v:3,save:{name:'LegacyName',coins:456}},friend={users:['legacy-a','legacy-b'],status:'ok',names:{'legacy-a':'LegacyName','legacy-b':'LegacyFriend'}};
  await legacy.query('INSERT INTO saves(id,data) VALUES($1,$2)',['legacy-a',JSON.stringify(save)]);
  await legacy.query('INSERT INTO friendships(id,data) VALUES($1,$2)',['legacy-a_legacy-b',JSON.stringify(friend)]);
  await legacy.exec(schema);await legacy.exec(schema);
  assert.deepEqual((await legacy.query('SELECT data FROM saves WHERE id=$1',['legacy-a'])).rows[0].data,save);
  assert.deepEqual((await legacy.query('SELECT data FROM friendships')).rows[0].data,friend);
  assert.equal((await legacy.query('SELECT id FROM users')).rows.length,2);
  for(const table of ['account_settings','nickname_holds'])assert.equal((await legacy.query('SELECT 1 FROM '+table)).rows.length,0);
 } finally {await legacy.close();}
});
