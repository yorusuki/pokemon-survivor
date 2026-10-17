'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {createApp,validateCredentials}=require('../index');
const root=path.join(__dirname,'../..');
const socialSource=fs.readFileSync(path.join(root,'js/net/social.js'),'utf8');
const valid=vm.runInNewContext(socialSource.match(/const VALID = (\/\^.*?\/u);/)[1]);
const origin='http://localhost:8080',password='unicode-fixture-password';
let db,server,base;
const stamp={__serverTimestamp:true};
function client(){let cookie='';return async(route,body={})=>{
  const r=await fetch(base+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,body:await r.json()};
};}
const commit=(c,writes)=>c('documents',{op:'commit',reads:[],writes});
const write=(path,data)=>({op:'set',path,data});
const read=(c,path)=>c('documents',{op:'get',path});
before(async()=>{
  db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
  let tail=Promise.resolve();const lock=async()=>{let release;const prev=tail;tail=new Promise(r=>{release=r;});await prev;return release;};
  const pool={async query(sql,args){const release=await lock();try{return await query(sql,args);}finally{release();}},async connect(){const release=await lock();return {query,release};}};
  server=createApp(pool,{origin,googleConfig:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});
test('中日韓、俄文、預組合重音與無附標阿拉伯文：註冊、暱稱、查詢、存檔、房間、排行榜往返保留原名',async()=>{
  const names=['小火龍訓練家','ピカチュウ','포켓몬친구','ТренерПикачу','Éclair_123','مدرببوكيمون','โปเกมอน'];
  for(const name of names){
    assert.equal(valid.test(name),true,name);assert.doesNotThrow(()=>validateCredentials({name,password}));
    const c=client(),reg=await c('auth/register',{name,password});assert.equal(reg.status,200,JSON.stringify(reg.body));const uid=reg.body.user.uid,lower=name.toLowerCase();
    const nick=await commit(c,[write('names/'+lower,{uid}),write('profiles/'+uid,{name,lower,at:stamp})]);assert.equal(nick.status,200,JSON.stringify(nick.body));
    assert.equal((await read(c,'names/'+lower)).body.data.uid,uid);
    assert.equal((await read(c,'profiles/'+uid)).body.data.name,name);
    assert.equal((await commit(c,[write('saves/'+uid,{save:{name,coins:1,tickets:{t1:0,t10:0}},v:3})])).status,200);
    assert.equal((await read(c,'saves/'+uid)).body.data.save.name,name);
    const room='rooms/'+uid;
    const made=await c('rooms',{op:'set',path:room,data:{host:uid,open:true,at:stamp,m:{[uid]:{name,dex:1,shiny:false,at:stamp}}}});assert.equal(made.status,200,JSON.stringify(made.body));
    assert.equal((await c('rooms',{op:'get',path:room+'/m'})).body.data[uid].name,name);
    await commit(c,[write('runs/'+uid,{startedAt:stamp,mode:'s'})]);
    const score={t:5,uids:[uid],names:[name],dex:[1],shiny:[false],lv:2,kills:5,at:stamp};
    assert.equal((await commit(c,[write('lb/s_unicode/e/'+uid,score)])).status,200);
    assert.equal((await read(c,'lbs/s_unicode')).body.data.top[uid].names[0],name);
    await c('auth/logout');const login=await c('auth/login',{name,password});assert.equal(login.status,200);assert.equal(login.body.user.uid,uid);
  }
});
test('空格、表情符號、標點、過短或組合附標按現有規則拒絕，不產生部分帳號',async()=>{
  for(const name of ['小智','玩家 A','玩家🔥','玩家-甲','cafe\u0301','ผู้เล่น']){
    assert.equal(valid.test(name),false,name);const r=await client()('auth/register',{name,password});assert.equal(r.status,400,name);
    assert.equal((await db.query('SELECT id FROM users WHERE login=$1',[name.toLowerCase()])).rows.length,0);
  }
  assert.equal(valid.test('éclair'),true);assert.equal(valid.test('e\u0301clair'),false);
});
test('核實現有 Unicode 邊界：İ 小寫附標、9 個補充平面漢字會在暱稱保存階段失敗並完整回滾',async()=>{
  for(const name of ['İpek','𠮷'.repeat(9)]){
    assert.equal(valid.test(name),true);const c=client(),reg=await c('auth/register',{name,password});assert.equal(reg.status,200);const uid=reg.body.user.uid,lower=name.toLowerCase();
    const claim=await commit(c,[write('names/'+lower,{uid}),write('profiles/'+uid,{name,lower,at:stamp})]);
    assert.ok([400,403].includes(claim.status),JSON.stringify(claim.body));
    assert.equal((await db.query('SELECT id FROM names WHERE id=$1',[lower])).rows.length,0);
    assert.equal((await db.query('SELECT id FROM profiles WHERE id=$1',[uid])).rows.length,0);
  }
});
