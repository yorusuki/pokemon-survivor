'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function scope(G={}){return {G,console,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},matchMedia:()=>({matches:false}),addEventListener(){},document:{addEventListener(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},performance:{now:()=>0}};}
function load(file,c){vm.createContext(c);vm.runInContext(read(file),c);return c.G;}
test('新增本機設定預設與邊界驗證',()=>{
 const G=load('js/core/settings.js',scope());assert.equal(G.Settings.get('attackOpacity'),1);assert.equal(G.Settings.get('healthPosition'),'hud');
 G.Settings.set('attackOpacity',-5);assert.equal(G.Settings.get('attackOpacity'),0);G.Settings.set('attackOpacity',NaN);assert.equal(G.Settings.get('attackOpacity'),1);
 G.Settings.set('healthPosition','below');G.Settings.set('healthPosition','malicious');assert.equal(G.Settings.get('healthPosition'),'below');
});
test('每隻寶可夢的 30 分鐘紀錄獨立、向下不覆蓋、多裝置合併取最大值',()=>{
 const G=load('js/core/db.js',scope());G.DB.playAsGuest();G.DB.grant(1,'starter');G.DB.grant(4,'starter');
 assert.equal(G.DB.recordSurvival(1,1799),false);assert.equal(G.DB.survivor(1),false);assert.equal(G.DB.recordSurvival(1,1800),true);
 assert.equal(G.DB.survivor(1),true);assert.equal(G.DB.survivor(4),false);assert.equal(G.DB.recordSurvival(25,2000),false);
 const a=JSON.parse(JSON.stringify(G.DB.save)),b=JSON.parse(JSON.stringify(a));a.updated=20;b.updated=10;b.survivalBest={1:1900,4:1801};
 const merged=G.DB.merge(a,b);assert.equal(merged.survivalBest[1],1900);assert.equal(merged.survivalBest[4],1801);
 G.DB.recordSurvival(1,5);assert.equal(G.DB.save.survivalBest[1],1800);
});
test('己方投射物不透明度不影響敵方投射物或傷害資料',()=>{
 const draws=[],G={LIFT:6,Settings:{get:()=>0.25},VFX:{forType:()=>({proj:'orb',pal:'normal'}),isDir:()=>false,spins:()=>false,draw:(ctx,shape,pal,x,y,o)=>draws.push(o.alpha)}};
 load('js/entities/projectile.js',scope(G));const a=G.Projectiles.spawn({dmg:123}),b=G.Projectiles.spawn({friendly:false,dmg:456});
 const ctx={beginPath(){},ellipse(){},fill(){}};G.Projectiles.draw(ctx);assert.deepEqual(draws,[0.25,1]);assert.equal(a.dmg,123);assert.equal(b.dmg,456);
});
test('合作升級暫停不重建敵人清單、舊回合確認不能解除新回合等待',()=>{
 const host='a'.repeat(32),guest='b'.repeat(32),frames=[];let handler,enemyCalls=0,resumed=0;
 const G={Net:{uid:host,slow:()=>false,send:(u,f)=>frames.push(JSON.parse(JSON.stringify(f))),on:fn=>handler=fn,onPeer(){}},DEX_BY:{1:{}},Player:class{},Sprites:{preload(){}},startMoveOf:()=>{throw Error('must not read local choice for teammate');},baseStartOf:()=>'',Social:{me:{name:'Host'}},U:{dist2:()=>0},EnemyMgr:{all:()=>{enemyCalls++;return[];}},Judgment:{netState:()=>null},NetProtocol:{message:()=>true}};
 load('js/net/coop.js',scope(G));const pl={activeGroup:()=>[],xpMul:1,x:0,y:0,hp:100,maxHp:100,magnet:70,aim:0};
 const api={team:()=>({time:2,level:2,xp:0,xpNext:10,kills:0,bosses:0,coins:0,t1:0,t10:0}),levelStart(){},waiting(){},resume:()=>resumed++,choosing:()=>false};
 G.Coop.begin({host,members:[{uid:host,name:'Host',dex:1},{uid:guest,name:'Guest',dex:1}]},pl,api);
 G.Coop.levelStart(2);assert.equal(enemyCalls,0);assert.equal(frames.at(-1).e.length,0);G.Coop.localPicked();
 const p=[0,0,0,0,100,100,0,'',1,70,0,1,0,0,0];handler(guest,{k:'f',p,ev:[['lp',1]]});assert.equal(resumed,1);
 G.Coop.levelStart(3);G.Coop.localPicked();handler(guest,{k:'f',p,ev:[['lp',1]]});assert.equal(resumed,1);
 handler(guest,{k:'f',p,ev:[['lp',2]]});assert.equal(resumed,2);G.Coop.end();
});

test('己方特效透明度範圍不污染敵方特效，例外後也恢復標記',()=>{
 const fills=[],G={Sprites:{PX:1},Settings:{fx:2,get:()=>0.25},U:{lerp:(a,b,t)=>a+(b-a)*t}};
 load('js/entities/fx.js',scope(G));G.FX.withAttack(()=>G.FX.ring(0,0,1,10,'red'));assert.throws(()=>G.FX.withAttack(()=>{throw new Error('fixture');}));G.FX.ring(0,0,1,10,'blue');
 const ctx={fillStyle:'',globalAlpha:1,fillRect(){fills.push({color:this.fillStyle,alpha:this.globalAlpha});}};G.FX.draw(ctx);
 assert.ok(fills.some(x=>x.color==='red'&&x.alpha===0.25));assert.ok(fills.some(x=>x.color==='blue'&&x.alpha===1));
});

test('敵方投射物撞牆的粒子不套用己方不透明度',()=>{
 let attack=false;const flags=[],shots=[{friendly:false,x:0,y:0,r:5,color:'red'}];
 const G={LIFT:6,Projectiles:{all:()=>shots},World:{projectileBlock:()=>true},EnemyMgr:{queryCircle:()=>[]},FX:{withAttack(fn,enabled=true){const old=attack;attack=enabled;try{return fn();}finally{attack=old;}},burst(){flags.push(attack);}}};
 load('js/systems/combat.js',scope(G));G.Combat.resolve(0.01,{x:0,y:0,r:5,dead:false},1);assert.deepEqual(flags,[false]);assert.equal(attack,false);
});
