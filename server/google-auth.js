'use strict';
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { fail } = require('./store');
const { consumeBudget } = require('./security');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const readCookie = (req,name) => new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)').exec(req.headers.cookie || '')?.[1];
function createGoogleAuth(ctx) {
  const { pool, origin, options, transaction, issue, cookie, rate, passwordTask, verifyPassword, deleteUser, registrationBudget } = ctx;
  const config = options.googleConfig || { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI };
  const enabled = !!(config.clientId || config.clientSecret);
  const redirectUri = origin + '/api/auth/google/callback';
  if (enabled && (!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId || '') || !config.clientSecret || /[\x00-\x20]/.test(config.clientSecret))) throw new Error('Google OAuth client ID／secret 設定不完整或格式錯誤');
  if (enabled && config.redirectUri && config.redirectUri !== redirectUri) throw new Error('GOOGLE_REDIRECT_URI 必須等於 APP_ORIGIN + /api/auth/google/callback');
  if (enabled && !origin.startsWith('https://') && !['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new Error('Google OAuth 正式環境必須使用 HTTPS');
  const client = enabled ? (options.googleClient || new OAuth2Client({ ...config, redirectUri, transporterOptions: { timeout: 10000, retry: false } })) : null;
  if(client && !options.googleClient) {
    const request=client.transporter.request.bind(client.transporter);
    // SDK 內部 retry 設定優先於 defaults；在 transport 邊界限制每次外部請求。
    client.transporter.request=opts=>request({...opts,timeout:8000,retry:false,retryConfig:{retry:0}});
  }
  const flowCookie = (value,age=600) => `ps_google_flow=${value}; Path=/api/auth/google/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https://') ? '; Secure' : ''}`;
  function appendCookie(res,value) { const old=res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie',[...(old ? (Array.isArray(old) ? old : [old]) : []),value]); }
  function requireEnabled() { if (!enabled) fail('google-disabled',503); }
  function binding(req) { const value=readCookie(req,'ps_google_flow'); if(!value) fail('google-invalid-state',400); return hash(value); }
  function sessionHash(req) { const t=readCookie(req,'ps_session'); return t ? hash(t) : null; }
  function redirect(res,path) { res.setHeader('Location',path); res.setHeader('Referrer-Policy','no-referrer'); res.writeHead(303); res.end(); }
  async function start(req,res,b,u,ip) {
    requireEnabled(); rate('google-start:'+ip,20,600000); rate('google-start-global',200,60000);
    if(!['login','link','delete'].includes(b.action) || !['/','/en/','/zh-TW/'].includes(b.returnTo)) fail('invalid-operation');
    if(b.action==='login' && u) fail('google-already-signed-in',409);
    if(b.action!=='login') {
      if(!u) fail('auth/invalid-credential',401);
      rate('google-sensitive:'+u.id,10,900000);
      if(b.action==='link' && (!u.password_hash || typeof b.password!=='string' || b.password.length>128 || !await passwordTask(()=>verifyPassword(b.password,u.password_hash)))) fail('auth/invalid-credential',401);
      if(b.action==='delete' && (u.password_hash || !u.google_linked)) fail('invalid-operation');
    }
    const state=random(), browser=random(), nonce=random(), verifier=random();
    await transaction(async db => {
      // 同一瀏覽器新流程取代舊流程，避免過期狀態互相覆蓋。
      const old=readCookie(req,'ps_google_flow');
      if(old) await db.query('DELETE FROM oauth_flows WHERE browser_hash=$1',[hash(old)]);
      await db.query('INSERT INTO oauth_flows(state_hash,browser_hash,action,user_id,session_hash,nonce,verifier,return_to,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(state),hash(browser),b.action,u?.id||null,b.action==='login'?null:sessionHash(req),nonce,verifier,b.returnTo,new Date(Date.now()+600000)]);
    });
    appendCookie(res,flowCookie(browser));
    const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
    const url=client.generateAuthUrl({ scope:['openid','email'], state, nonce, code_challenge:challenge, code_challenge_method:'S256', prompt:b.action==='delete'?'consent select_account':'select_account' });
    return { url };
  }
  async function callback(req,res,url) {
    requireEnabled();
    const state=url.searchParams.get('state');
    if(!/^[a-f0-9]{64}$/.test(state||'') || url.searchParams.getAll('state').length!==1) fail('google-invalid-state');
    const browser=binding(req);
    const flow=await transaction(async db => (await db.query("UPDATE oauth_flows SET stage='processing' WHERE state_hash=$1 AND browser_hash=$2 AND stage='pending' AND expires_at>now() RETURNING *",[hash(state),browser])).rows[0]);
    if(!flow) fail('google-invalid-state');
    try {
      if(url.searchParams.has('error')) fail('google-cancelled');
      const code=url.searchParams.get('code');
      if(!code || code.length>4096 || url.searchParams.getAll('code').length!==1) fail('google-verification-failed');
      const { tokens }=await client.getToken({ code, codeVerifier:flow.verifier, redirect_uri:redirectUri });
      if(typeof tokens?.id_token!=='string') fail('google-verification-failed');
      const ticket=await client.verifyIdToken({ idToken:tokens.id_token, audience:config.clientId });
      const claims=ticket.getPayload();
      const now=Math.floor(Date.now()/1000);
      if(!claims || claims.nonce!==flow.nonce || typeof claims.sub!=='string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(claims.sub) || !Number.isFinite(claims.exp) || claims.exp<=now || !Number.isFinite(claims.iat) || claims.iat<Math.floor(new Date(flow.created_at).getTime()/1000)-60 || claims.iat>now+60 || claims.iat<now-660) fail('google-verification-failed');
      const saved=await pool.query("UPDATE oauth_flows SET stage='verified',google_sub=$3,verifier='',nonce='' WHERE state_hash=$1 AND browser_hash=$2 AND stage='processing' AND expires_at>now() RETURNING state_hash",[hash(state),browser,claims.sub]);
      if(!saved.rows.length) fail('google-invalid-state');
      return redirect(res,'/oauth-result.html?state='+state);
    } catch(e) {
      await pool.query('DELETE FROM oauth_flows WHERE state_hash=$1 AND browser_hash=$2',[hash(state),browser]);
      appendCookie(res,flowCookie('',0));
      // 不記錄 SDK 原始錯誤：其 request 可能包含 code、client secret 或 token。
      return redirect(res,'/oauth-result.html?error='+(e.code==='google-cancelled'?'cancelled':'verification'));
    }
  }
  async function complete(req,res,b,u) {
    requireEnabled(); rate('google-complete-global',300);
    if(!/^[a-f0-9]{64}$/.test(b.state||'')) fail('google-invalid-state');
    const browser=binding(req);
    const result=await transaction(async db => {
      const f=(await db.query("DELETE FROM oauth_flows WHERE state_hash=$1 AND browser_hash=$2 AND stage='verified' AND expires_at>now() RETURNING *",[hash(b.state),browser])).rows[0];
      if(!f) fail('google-invalid-state');
      if(f.action==='login' ? !!u : (!u || u.id!==f.user_id || sessionHash(req)!==f.session_hash)) fail('google-session-changed',403);
      let identity=(await db.query('SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.google_sub=$1',[f.google_sub])).rows[0];
      if(f.action==='delete') {
        if(!identity || identity.id!==u.id || u.password_hash) fail('google-account-mismatch',403);
        await deleteUser(db,u.id);
        return { deleted:true,uid:u.id,returnTo:f.return_to };
      }
      if(f.action==='link') {
        if(identity && identity.id!==u.id) fail('google-credential-in-use',409);
        const existing=(await db.query('SELECT google_sub FROM google_identities WHERE user_id=$1',[u.id])).rows[0];
        if(existing && existing.google_sub!==f.google_sub) fail('google-already-linked',409);
        if(!existing) await db.query('INSERT INTO google_identities(google_sub,user_id) VALUES($1,$2)',[f.google_sub,u.id]);
        identity=u;
      } else if(!identity) {
        await consumeBudget(db,'registration',registrationBudget);
        const id=crypto.randomBytes(16).toString('hex');
        identity=(await db.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$2,$3,NULL) RETURNING *',[id,'g_'+id,'Trainer_'+id.slice(0,6)])).rows[0];
        await db.query('INSERT INTO google_identities(google_sub,user_id) VALUES($1,$2)',[f.google_sub,id]);
      }
      return { identity,returnTo:f.return_to,action:f.action };
    });
    if(result.deleted) res.setHeader('Set-Cookie',cookie('',0));
    else if(result.action==='login') await issue(res,result.identity);
    appendCookie(res,flowCookie('',0));
    return { ok:true,returnTo:result.returnTo,...(result.deleted ? { deleted:true,uid:result.uid } : {}) };
  }
  return { enabled,start,callback,complete };
}
module.exports={createGoogleAuth};
