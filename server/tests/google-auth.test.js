'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {OAuth2Client}=require('google-auth-library');
const {createApp}=require('../index');
const origin='http://localhost:8080',password='fixture-password-123';
const config={clientId:'12345-fixture.apps.googleusercontent.com',clientSecret:'fixture-not-a-real-secret'};
const sdk=new OAuth2Client({...config,redirectUri:origin+'/api/auth/google/callback'});
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const certs={fixture:keys.publicKey.export({type:'spki',format:'pem'})};
const claimsByCode=new Map();
let db,pool,server,base,exchangeCount=0,clientNumber=0;
const proxySecret='fixture-proxy-'.padEnd(40,'x');
function jwt(claims,badSignature=false) {
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url');
  const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return head+'.'+body+'.'+crypto.sign('RSA-SHA256',Buffer.from(head+'.'+body),keys.privateKey).toString('base64url')+(badSignature?'x':'');
}
const googleClient={
  generateAuthUrl:opts=>sdk.generateAuthUrl(opts),
  async getToken(opts) {
    exchangeCount++;
    const fixture=claimsByCode.get(opts.code); assert.ok(fixture,'交換必須使用測試 code');
    assert.equal(crypto.createHash('sha256').update(opts.codeVerifier).digest('base64url'),fixture.challenge);
    assert.equal(opts.redirect_uri,origin+'/api/auth/google/callback');
    if(fixture.fail) throw new Error('provider exchange failed');
    return {tokens:{id_token:jwt(fixture.claims,fixture.badSignature)}};
  },
  // 使用官方 SDK 真正的 RSA JWT 驗證；只有 Google 網路交換與憑證取得使用 fixture。
  async verifyIdToken({idToken,audience}) {
    return sdk.verifySignedJwtWithCertsAsync(idToken,certs,audience,['accounts.google.com','https://accounts.google.com']);
  }
};
function client() {
  const jar=new Map(),ip='192.0.2.'+(++clientNumber);
  const call=async(route,body={},opts={})=>{
    const headers={'X-PS-Proxy-Token':proxySecret,'X-PS-Client-IP':ip,Origin:origin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...opts.headers};
    const r=await fetch(base+'/api/'+route,{method:opts.get?'GET':'POST',headers,body:opts.get?undefined:JSON.stringify(body),redirect:'manual'});
    for(const v of r.headers.getSetCookie()) {const item=v.split(';')[0],i=item.indexOf('=');jar.set(item.slice(0,i),item.slice(i+1));}
    return {status:r.status,body:r.status===303?null:await r.json(),location:r.headers.get('location'),cookies:r.headers.getSetCookie()};
  };
  call.jar=jar;return call;
}
async function begin(c,action='login',pw=password) {
  const r=await c('auth/google/start',{action,password:pw,returnTo:'/zh-TW/'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const url=new URL(r.body.url);assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.match(r.cookies.join(' '),/HttpOnly; SameSite=Lax/);
  assert.equal(url.searchParams.get('scope'),'openid email');
  return {state:url.searchParams.get('state'),nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge'),url};
}
async function callback(c,f,sub='google-fixture',extra={}) {
  const code=crypto.randomBytes(16).toString('hex'),now=Math.floor(Date.now()/1000);
  claimsByCode.set(code,{challenge:f.challenge,claims:{iss:'https://accounts.google.com',aud:config.clientId,sub,nonce:f.nonce,iat:now,exp:now+3600,...extra.claims},...extra});
  return c('auth/google/callback?state='+f.state+'&code='+code,{}, {get:true,headers:{Origin:'https://accounts.google.com'}});
}
async function finish(c,f,sub,extra) {
  const cb=await callback(c,f,sub,extra);assert.equal(cb.status,303);assert.equal(cb.location,'/oauth-result.html?state='+f.state);
  return c('auth/google/complete',{state:f.state});
}
async function register(c,name) {const r=await c('auth/register',{name,password});assert.equal(r.status,200);return r.body.user.uid;}
before(async()=>{
  db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
  let tail=Promise.resolve();const lock=async()=>{let release;const prev=tail;tail=new Promise(r=>{release=r;});await prev;return release;};
  pool={async query(sql,args){const release=await lock();try{return await query(sql,args);}finally{release();}},async connect(){const release=await lock();return {query,release};}};
  server=createApp(pool,{origin,googleConfig:config,googleClient,proxySecret});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});
test('Google 設定預設關閉；部分設定、錯誤 callback 與非 HTTPS 正式站拒絕啟動',async()=>{
  for(const googleConfig of [{clientId:config.clientId},{clientSecret:'x'},{...config,redirectUri:'https://evil.test/callback'}]) assert.throws(()=>createApp(pool,{origin,googleConfig}));
  assert.throws(()=>createApp(pool,{origin:'http://example.com',googleConfig:config}));
  const disabled=createApp(pool,{origin,googleConfig:{}});await new Promise(r=>disabled.listen(0,'127.0.0.1',r));
  try {const url='http://127.0.0.1:'+disabled.address().port;const r=await fetch(url+'/api/auth/config',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.deepEqual(await r.json(),{googleEnabled:false});}finally{await new Promise(r=>disabled.close(r));}
});
test('首次 Google 登入，callback 不提前發 session；完成後 UID 重用且保留存檔',async()=>{
  const c=client(),f=await begin(c);assert.equal((await callback(c,f,'repeat-user')).status,303);
  assert.equal((await c('auth/session')).body.user,null);const r=await c('auth/google/complete',{state:f.state});assert.equal(r.status,200);assert.match(r.cookies.join(' '),/SameSite=Strict/);
  const u=(await c('auth/session')).body.user;assert.equal(u.hasPassword,false);assert.equal(u.email,'');assert.deepEqual(u.providerData,[{providerId:'google.com'}]);
  await pool.query('INSERT INTO saves(id,data) VALUES($1,$2)',[u.uid,JSON.stringify({name:'Tester',coins:42})]);
  await c('auth/logout');const f2=await begin(c);assert.equal((await finish(c,f2,'repeat-user')).status,200);assert.equal((await c('auth/session')).body.user.uid,u.uid);
  assert.equal((await pool.query('SELECT data FROM saves WHERE id=$1',[u.uid])).rows[0].data.coins,42);
  assert.equal((await c('auth/google/complete',{state:f2.state})).status,400);
});
test('密碼帳號綁定需正確密碼；Google 登入取得原 UID／存檔，密碼登入仍可使用',async()=>{
  const c=client(),uid=await register(c,'LinkTrainer');
  assert.equal((await c('auth/google/start',{action:'link',password:'wrong-password',returnTo:'/'})).status,401);
  const f=await begin(c,'link');assert.equal((await finish(c,f,'linked-user')).status,200);
  let u=(await c('auth/session')).body.user;assert.equal(u.uid,uid);assert.equal(u.hasPassword,true);assert.equal(u.providerData.length,1);
  await pool.query('INSERT INTO saves(id,data) VALUES($1,$2)',[uid,JSON.stringify({name:'LinkTrainer',coins:77})]);
  await c('auth/logout');assert.equal((await finish(c,await begin(c),'linked-user')).status,200);assert.equal((await c('auth/session')).body.user.uid,uid);
  assert.equal((await pool.query('SELECT data FROM saves WHERE id=$1',[uid])).rows[0].data.coins,77);
  await c('auth/logout');const login=await c('auth/login',{name:'LinkTrainer',password});assert.equal(login.status,200);assert.equal(login.body.user.providerData.length,1);
  assert.equal((await finish(c,await begin(c,'link'),'linked-user')).status,200);
  const conflict=await finish(c,await begin(c,'link'),'other-google');assert.equal(conflict.status,409);
});
test('Google 已綁其他帳號時拒絕合併，既有 UID 不變；未登入不能綁定',async()=>{
  const c=client(),uid=await register(c,'ConflictTrainer');const r=await finish(c,await begin(c,'link'),'linked-user');assert.equal(r.status,409);assert.equal(r.body.error,'google-credential-in-use');assert.equal((await c('auth/session')).body.user.uid,uid);
  assert.equal((await client()('auth/google/start',{action:'link',password,returnTo:'/'})).status,401);
  assert.equal((await c('auth/google/start',{action:'login',returnTo:'/'})).status,409);
});
test('Google callback 防偽造 state、跨瀏覽器、重放與到期；拒絕任意轉址與 CSRF',async()=>{
  const c=client(),f=await begin(c),other=client(),count=exchangeCount;
  assert.equal((await callback(other,f)).status,400);assert.equal(exchangeCount,count);
  assert.equal((await c('auth/google/callback?state='+('a'.repeat(64))+'&code=x',{}, {get:true})).status,400);
  assert.equal((await c('auth/google/start',{action:'login',returnTo:'https://evil.test'})).status,400);
  assert.equal((await c('auth/google/start',{action:'login',returnTo:'/'},{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await callback(c,f,'state-user')).status,303);assert.equal((await callback(c,f,'state-user')).status,400);
  const f2=await begin(c);await pool.query('UPDATE oauth_flows SET expires_at=now()-interval \'1 second\' WHERE state_hash=$1',[crypto.createHash('sha256').update(f2.state).digest('hex')]);assert.equal((await callback(c,f2)).status,400);
});
test('官方 JWT verifier 拒絕錯誤簽章、aud、iss、exp、nonce、過舊 iat 及交換失敗',async()=>{
  const fixtures=[{badSignature:true},{claims:{aud:'other-client'}},{claims:{iss:'https://evil.test'}},{claims:{iat:1,exp:2}},{claims:{nonce:'wrong'}},{claims:{iat:Math.floor(Date.now()/1000)-1000}},{fail:true}];
  for(const extra of fixtures) {const c=client(),f=await begin(c);const cb=await callback(c,f,'invalid-user',extra);assert.equal(cb.status,303);assert.equal(cb.location,'/oauth-result.html?error=verification');assert.equal((await c('auth/session')).body.user,null);assert.equal((await c('auth/google/complete',{state:f.state})).status,400);}
});
test('取消授權保留帳號；link 綁定 exact session，授權中切換登入狀態不能完成',async()=>{
  const c=client(),uid=await register(c,'SwitchTrainer');const f=await begin(c,'link');
  const cancelled=await c('auth/google/callback?state='+f.state+'&error=access_denied',{}, {get:true});assert.equal(cancelled.location,'/oauth-result.html?error=cancelled');assert.equal((await c('auth/session')).body.user.uid,uid);
  const f2=await begin(c,'link');await callback(c,f2,'switch-user');await c('auth/logout');await c('auth/login',{name:'SwitchTrainer',password});const r=await c('auth/google/complete',{state:f2.state});assert.equal(r.status,403);assert.equal((await c('auth/session')).body.user.providerData.length,0);
});
test('Google-only 刪除需新 Google 驗證，同 sub 才清理存檔／session／身分；密碼刪除不能繞過',async()=>{
  const c=client();await finish(c,await begin(c),'delete-user');const uid=(await c('auth/session')).body.user.uid;
  await pool.query('INSERT INTO saves(id,data) VALUES($1,$2)',[uid,JSON.stringify({coins:12})]);
  assert.equal((await c('auth/delete',{password})).status,401);
  const wrong=await begin(c,'delete');assert.equal(wrong.url.searchParams.get('prompt'),'consent select_account');assert.equal((await finish(c,wrong,'wrong-user')).status,403);assert.equal((await c('auth/session')).body.user.uid,uid);
  const result=await finish(c,await begin(c,'delete'),'delete-user');assert.equal(result.status,200);assert.equal(result.body.deleted,true);assert.equal(result.body.uid,uid);assert.equal((await c('auth/session')).body.user,null);
  for(const table of ['users','saves']) assert.equal((await pool.query('SELECT id FROM '+table+' WHERE id=$1',[uid])).rows.length,0);
  assert.equal((await pool.query('SELECT user_id FROM google_identities WHERE user_id=$1',[uid])).rows.length,0);
});
test('綁定 Google 的密碼帳號仍以密碼刪除；私有 OAuth 表不能透過 documents 存取',async()=>{
  const c=client();await register(c,'MixedDelete');await finish(c,await begin(c,'link'),'mixed-delete');
  assert.equal((await c('auth/google/start',{action:'delete',returnTo:'/'})).status,400);
  assert.equal((await c('documents',{op:'get',path:'google_identities/mixed-delete'})).status,400);
  assert.equal((await c('auth/delete',{password:'bad-password'})).status,401);assert.equal((await c('auth/delete',{password})).status,200);
});

test('從舊版 NOT NULL schema 升級、重跑保留 UID／密碼／存檔，新表權限正確',async()=>{
  const legacy=new PGlite();
  const schema=fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
  const {grantRuntime}=require('../bootstrap');
  try {
    await legacy.exec(schema.split('-- Google 身分')[0]);
    const {hashPassword}=require('../index'),uid='c'.repeat(32),stored=await hashPassword(password);
    await legacy.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$2,$3,$4)',[uid,'migrationkeep','MigrationKeep',stored]);
    await legacy.query('INSERT INTO saves(id,data) VALUES($1,$2)',[uid,JSON.stringify({coins:99})]);
    const nullable=async()=> (await legacy.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'")).rows[0].is_nullable;
    assert.equal(await nullable(),'NO');
    await legacy.exec(schema);await legacy.exec(schema);
    assert.equal(await nullable(),'YES');
    assert.equal((await legacy.query('SELECT password_hash FROM users WHERE id=$1',[uid])).rows[0].password_hash,stored);
    assert.equal((await legacy.query('SELECT data FROM saves WHERE id=$1',[uid])).rows[0].data.coins,99);
    await grantRuntime(legacy,'fixture-password-that-is-at-least-32-characters');
    for(const table of ['google_identities','oauth_flows']) {
      const privilege=await legacy.query("SELECT has_table_privilege('pokesurvivor_app',$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[table]);
      assert.equal(privilege.rows[0].allowed,true);
    }
  } finally {await legacy.close();}
});
test('HTTPS 的 OAuth flow cookie 為 Secure，API 永不回傳 client secret',async()=>{
  const https='https://game.example.com',s=createApp(pool,{origin:https,googleConfig:config,googleClient});await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try {const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/auth/google/start',{method:'POST',headers:{Origin:https,'Content-Type':'application/json'},body:JSON.stringify({action:'login',returnTo:'/'})});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);assert.ok(!(await r.text()).includes(config.clientSecret));}finally{await new Promise(r=>s.close(r));}
});
test('結果頁只導回允許路徑、以文字顯示錯誤，刪除僅清理對應 UID 本機副本',async()=>{
  const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../../js/oauth-result.js'),'utf8');
  async function run(data,status=200,search='?state='+'a'.repeat(64)) {
    const message={textContent:''},removed=[],redirects=[],history=[];
    await vm.runInNewContext(source,{URLSearchParams,document:{getElementById:()=>message},location:{search,replace:p=>redirects.push(p)},history:{replaceState:(...args)=>history.push(args)},localStorage:{removeItem:k=>removed.push(k)},fetch:async()=>({ok:status===200,json:async()=>data})});
    return {message,removed,redirects,history};
  }
  const success=await run({ok:true,returnTo:'/zh-TW/'});assert.deepEqual(success.redirects,['/zh-TW/']);assert.equal(success.history[0][2],'/oauth-result.html');
  const malicious=await run({returnTo:'https://evil.test/'});assert.equal(malicious.redirects.length,0);
  const failed=await run({error:'<script>alert(1)</script>'},403);assert.ok(!failed.message.textContent.includes('<script>'));
  const uid='b'.repeat(32),deleted=await run({deleted:true,uid,returnTo:'/'});assert.deepEqual(deleted.removed,['ps.cloud.'+uid,'ps.recover.no.'+uid]);
  const cancelled=await run({},200,'?error=cancelled');assert.ok(cancelled.message.textContent.includes('取消'));assert.equal(cancelled.redirects.length,0);
});
