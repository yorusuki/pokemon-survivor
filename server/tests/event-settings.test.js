'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {gameConfig}=require('../game-config');
const {createApp}=require('../index');
const root=path.join(__dirname,'../..');
const sql=fs.readFileSync(path.join(root,'deployment/grant-existing-users.sql'),'utf8');
const template=JSON.parse(sql.match(/\$save\$([\s\S]*?)\$save\$/)[1]);
function loadDb() {
  const ctx={G:{},console,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},addEventListener(){},document:{addEventListener(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js/core/db.js'),'utf8'),ctx);return ctx.G.DB;
}
function gacha(rules) {
  const G={Backend:{gameRules:rules},DEX:[1,2,3,4,5].map(r=>({dex:r,rarity:r,gen:1})),SPRITE_META:{1:1,2:1,3:1,4:1,5:1},Sprites:{hasShiny:()=>true},U:{pick:list=>list[0]}};
  const ctx={G,Math:Object.assign(Object.create(Math),{random:()=>0.95})};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/systems/gacha.js'),'utf8'),ctx);return G;
}
const save=()=>({tickets:{t1:100,t10:1},pity:{},shiny:{},owned:{},stats:{},coins:0});
test('活動開關明確 true／false；權重與異色率正確，非法設定拒絕',()=>{
  const normal=gameConfig('false'),event=gameConfig('true');
  assert.deepEqual(normal.gachaRates,[[1,45],[2,30],[3,17],[4,6.5],[5,1.5]]);
  assert.deepEqual(event.gachaRates,[[1,40],[2,30],[3,17],[4,6.5],[5,6.5]]);
  assert.equal(event.gachaRates.reduce((n,p)=>n+p[1],0),100);
  assert.equal(event.wildShinyRate,1/2048);assert.equal(event.riftShinyRate,1/40);
  assert.equal(normal.wildShinyRate,1/4096);assert.equal(normal.riftShinyRate,1/512);
  assert.throws(()=>gameConfig('TRUE'));assert.throws(()=>gameConfig('1'));
  const G=gacha(normal);assert.equal(G.Gacha.pull(save(),1)[0].rarity,4);
  G.Backend.gameRules=event;assert.equal(G.Gacha.pull(save(),1)[0].rarity,5);
  assert.equal(G.Gacha.RATES[0][1],40);assert.equal(G.Gacha.SHINY_RATE,3/100);
  const pity=save();pity.pity[1]=69;assert.equal(G.Gacha.pull(pity,1)[0].rarity,5);
});
test('設定 API 為同源公開資料，不需登入；兩種開關都回傳對應值',async()=>{
  for(const value of ['false','true']) {
    const app=createApp({query:async()=>({rows:[]})},{origin:'http://localhost:8080',eventBoost:value,googleConfig:{}});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    try {const r=await fetch('http://127.0.0.1:'+app.address().port+'/api/game-config',{method:'POST',headers:{Origin:'http://localhost:8080','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.deepEqual(await r.json(),gameConfig(value));} finally {await new Promise(r=>app.close(r));}
  }
});
test('SQL 全帳號配發：既有帳本、舊存檔、無存檔皆保留原值追加，重跑不重複且真實跨裝置合併保留',async()=>{
  const db=new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
    for(const id of ['a','b','c'])await db.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$1,$2,NULL)',[id,'Trainer_'+id]);
    const original={...structuredClone(template),coins:750,tickets:{t1:3,t10:4},owned:{1:{at:1,from:'starter'}},partner:1,led:{base:{c:[800,50],t1:[3,0],t10:[5,1]}}};
    const old={...structuredClone(template),coins:600,tickets:{t1:7,t10:2}};
    await db.query('INSERT INTO saves(id,data) VALUES($1,$2)', ['a',JSON.stringify({v:3,save:original,ban:false})]);
    await db.query('INSERT INTO saves(id,data) VALUES($1,$2)', ['b',JSON.stringify({v:3,save:old})]);
    await db.exec(sql);
    const rows=(await db.query('SELECT id,data,revision FROM saves ORDER BY id')).rows;
    assert.deepEqual(rows.map(r=>r.data.save.coins),[600750,600600,600500]);
    assert.deepEqual(rows.map(r=>r.data.save.tickets.t10),[204,202,200]);
    assert.equal(rows[0].data.save.tickets.t1,3);assert.equal(rows[0].data.save.partner,1);assert.equal(rows[0].data.ban,false);
    assert.equal(rows[2].data.save.partner,null);assert.equal(rows[2].data.save.stats.runs,0);
    const DB=loadDb();
    const merged=DB.merge(original,rows[0].data.save);assert.equal(merged.coins,600750);assert.equal(merged.tickets.t10,204);
    const twice=DB.merge(merged,rows[0].data.save);assert.equal(twice.coins,600750);assert.equal(twice.tickets.t10,204);
    merged.led.spend={c:[0,100],t10:[0,1]};merged.coins-=100;merged.tickets.t10--;
    const spent=DB.merge(merged,rows[0].data.save);assert.equal(spent.coins,600650);assert.equal(spent.tickets.t10,203);
    await db.exec(sql);assert.deepEqual((await db.query('SELECT id,data,revision FROM saves ORDER BY id')).rows,rows);
    // API runtime 的正式 schema 不新增活動表；只改既有存檔 JSONB。
    assert.equal((await db.query("SELECT table_name FROM information_schema.tables WHERE table_name='account_rewards'")).rows.length,0);
  } finally {await db.close();}
});
test('SQL 遇到餘額／帳本不一致時整批回滾，不覆蓋或部分發放',async()=>{
  const db=new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
    for(const id of ['a','z'])await db.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$1,$2,NULL)',[id,'Trainer_'+id]);
    const broken={...structuredClone(template),coins:500,led:{base:{c:[400,0],t10:[0,0]}}};
    await db.query('INSERT INTO saves(id,data) VALUES($1,$2)',['z',JSON.stringify({v:3,save:broken})]);
    await assert.rejects(()=>db.exec(sql));await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT id FROM saves WHERE id='a'")).rows.length,0);
    assert.equal((await db.query("SELECT data FROM saves WHERE id='z'")).rows[0].data.save.coins,500);
  } finally {await db.close();}
});

test('野生與裂縫異色判斷使用目前活動設定，不再固定舊機率',()=>{
  const spawner=fs.readFileSync(path.join(root,'js/systems/spawner.js'),'utf8');
  const fn=spawner.match(/function rollShiny\(dex\) \{[\s\S]*?\n  \}/)[0];
  const rift=fs.readFileSync(path.join(root,'js/systems/rift.js'),'utf8');
  const expression=rift.split('\n').find(line=>line.includes('shiny: G.Sprites.hasShiny')).trim().replace(/^.*shiny: /,'').replace(/,$/,'');
  for(const enabled of [false,true]) {
    const G={Backend:{gameRules:gameConfig(String(enabled))},Sprites:{hasShiny:()=>true}};
    const wild=vm.runInNewContext('('+fn+')',{G,forceShiny:0,SHINY_RATE:1/4096,Math:{random:()=>1/3000}});
    assert.equal(wild(1),enabled);
    assert.equal(vm.runInNewContext(expression,{G,mon:{dex:1},Math:{random:()=>1/100}}),enabled);
  }
});
test('拉霸依 CSS 尺寸與 DPR 建立 backing canvas，文字使用可讀字型與翻譯後量測',()=>{
  const frames=[],events=new Map(),texts=[],transforms=[];
  const context=new Proxy({font:'',measureText:text=>({width:[...text].length*9}),fillText(text){texts.push({text,font:this.font});},setTransform(...args){transforms.push(args);}}, {get:(obj,key)=>key in obj?obj[key]:()=>{}});
  let width=528;
  const canvas={width:176,height:170,getContext:()=>context,getBoundingClientRect:()=>({width})};
  const G={Icons:{RARITY_BALL:{1:'ball'},draw(){}},Gacha:{RARITY_COLOR:{1:'#fff'},RARITY_NAME:{1:'Común'}},Audio:{sfx(){}},T:text=>text==='POKé SLOTS'?'寶可夢拉霸':text==='¡SUERTE!'?'祝你好運！':text};
  const scope={G,devicePixelRatio:2,performance:{now:()=>0},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},setTimeout(){},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/ui/slots.js'),'utf8'),scope);
  G.Slots.play(canvas,[{rarity:1,shiny:false}]);
  assert.equal(canvas.width,1056);assert.equal(canvas.height,1020);
  frames.shift()(16);
  assert.ok(texts.some(x=>x.text==='寶可夢拉霸'));
  assert.ok(texts.some(x=>x.text==='祝你好運！' && x.font.includes('9px system-ui')));
  assert.ok(texts.every(x=>!x.font.includes('Pixelify')));
  assert.ok(transforms.some(args=>args[0]===6 && args[3]===6));
  width=264;events.get('resize')();assert.equal(canvas.width,528);
});

test('抽卡異色為星級決定後的獨立 3%，不改星級或保底',()=>{
 for(const enabled of ['false','true']) for(const rarityRoll of [.1,.6,.8,.9,.99]) {
  const results=[];
  for(const shinyRoll of [.029999,.03]) {
   const G={Backend:{gameRules:gameConfig(enabled)},DEX:[1,2,3,4,5].map(r=>({dex:r,rarity:r,gen:1})),SPRITE_META:{1:1,2:1,3:1,4:1,5:1},Sprites:{hasShiny:()=>true},U:{pick:list=>list[0]}};
   const values=[rarityRoll,shinyRoll];vm.runInNewContext(fs.readFileSync(path.join(root,'js/systems/gacha.js'),'utf8'),{G,Math:Object.assign(Object.create(Math),{random:()=>values.shift()})});results.push(G.Gacha.pull(save(),1)[0]);
  }
  assert.equal(results[0].rarity,results[1].rarity);assert.equal(results[0].shiny,true);assert.equal(results[1].shiny,false);
 }
});
