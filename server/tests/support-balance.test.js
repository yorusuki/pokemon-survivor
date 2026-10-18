'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../..');
function fixture(){
 const G={Game:{st:{time:0},everyone:()=>[{level:1}]},U:{dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},World:{isWall:()=>false},FX:{burst(){},ring(){},dmgText(){}},Coop:{isHost:false},Camera:{sees:()=>false},Audio:{sfx(){}},Judgment:{noteDmg(){}}};
 const c={G,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/entities/enemy.js'),'utf8'),c);
 const make=(extra={})=>Object.assign(Object.create(G.Enemy.prototype),{id:1,x:0,y:0,hp:1000,maxHp:1000,shield:0,bodyH:20,behavior:'chase',anim:{play(){}},showHurt(){},die(){this.dead=true;}},extra);
 return {G,make};
}
test('護盾先吸收傷害；遠端不能自行補盾',()=>{
 const {make,G}=fixture(),a=make({hp:50,shield:10});a.hurt(1000);assert.equal(a.dead,true);
 const b=make({shield:100});b.hurt(20);assert.equal(b.shield,80);assert.equal(b.hp,1000);
 G.Coop.hit=()=>{};const c=make({remote:true});c.hurt(20);assert.equal(c.receiveSupport('shield',1),0);
});
test('玩家等級決定每次 5～12%，不依攻擊，合作取存活最高等級',()=>{
 for(const [players,expected] of [[[{level:1,atk:999}],50],[[{level:50.5}],85],[[{level:100}],120],[[{level:999}],120],[[{level:1},{level:100,dead:true}],50]]) {
  const {G,make}=fixture(),a=make({hp:500}),h=make({behavior:'healer'});G.Game.everyone=()=>players;G.EnemyMgr.queryCircle=()=>[a];h.healAround();assert.ok(Math.abs(a.hp-500-expected)<1e-8);
 }
});
test('同一目標來自不同治療者，3 秒內最多一次',()=>{
 const {G,make}=fixture(),a=make({hp:500}),h1=make({behavior:'healer'}),h2=make({behavior:'healer'});G.EnemyMgr.queryCircle=()=>[a];
 h1.healAround();assert.equal(a.hp,550);h2.healAround();assert.equal(a.hp,550);G.Game.st.time=2.999;h2.healAround();assert.equal(a.hp,550);G.Game.st.time=3;h2.healAround();assert.equal(a.hp,600);
});
test('不自療但能互補，原範圍內不限人數、隔牆與特殊敵人可補',()=>{
 const {G,make}=fixture(),h=make({behavior:'healer',hp:500}),other=make({behavior:'healer',hp:500}),targets=Array.from({length:20},()=>make({hp:500})),special=['boss','legend','judge'].map(k=>make({[k]:true,hp:500}));
 G.World.isWall=()=>true;let radius;G.EnemyMgr.queryCircle=(x,y,r)=>{radius=r;return [h,other,...targets,...special];};h.healAround();assert.equal(radius,150);assert.equal(h.hp,500);assert.equal(other.hp,550);assert.ok([...targets,...special].every(e=>e.hp===550));
});
test('遠端與死亡副本不能回復；滿血受療不消耗間隔',()=>{
 const {make}=fixture();assert.equal(make({remote:true,hp:1}).receiveSupport('heal',0),0);assert.equal(make({dead:true,hp:1}).receiveSupport('heal',0),0);
 const a=make();assert.equal(a.receiveSupport('heal',0),0);a.hp=900;assert.equal(a.receiveSupport('heal',0),50);
});
test('護盾等級 10～40%，跨來源 2.5 秒限制且總盾不超過當前比例',()=>{
 const {make}=fixture(),a=make();assert.equal(a.receiveSupport('shield',0,.4),400);a.hurt(100);assert.equal(a.receiveSupport('shield',2.499,.4),0);assert.equal(a.receiveSupport('shield',2.5,.4),100);assert.equal(a.shield,400);assert.equal(a.receiveSupport('shield',5,.4),0);assert.equal(a.receiveSupport('shield',5,.1),0);assert.equal(a.shield,400);
 a.shield=0;assert.equal(a.receiveSupport('shield',5,.1),100);assert.equal(a.shield,100);assert.equal(a.shieldT,8);
});
test('護盾不能自施，可穿牆與補特殊敵人，單次保留最多六個目標',()=>{
 for(const [level,shield] of [[1,100],[100,400]]) {
 const {G,make}=fixture(),h=make({behavior:'shielder'}),targets=['boss','legend','judge'].map((k,i)=>make({id:i+2,[k]:true}));for(let i=0;i<7;i++)targets.push(make({id:i+5}));
 G.Game.everyone=()=>[{level}];G.World.isWall=()=>true;G.EnemyMgr.queryCircle=()=>[h,...targets];h.castShields();assert.equal(h.shield,0);assert.equal(targets.filter(e=>e.shield>0).length,6);assert.ok(targets.slice(0,3).every(e=>Math.abs(e.shield-shield)<1e-8));
 }
});
test('無回復總額限制時，低輸出確實可能被持續治療抵銷',()=>{
 const {make}=fixture(),a=make({hp:500});for(let t=0;t<100;t++){a.hurt(1);a.receiveSupport('heal',t,.12);}assert.equal(a.dead,undefined);assert.ok(a.hp>900);
});
test('生成器：前 60 秒排除支援，治療與護盾單人合作各上限 25',()=>{
 for(const [n,time,expected] of [[1,59,0],[1,60,25],[4,60,25]]){
  const all=[],bag=[{dex:1,behavior:'healer'},{dex:2,behavior:'shielder'},{dex:3,behavior:'chase'}];
  const G={U:{pick:a=>a[0],rand:a=>a,dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},Camera:{outerRadius:()=>100},World:{isFree:()=>true},Sprites:{hovers:()=>false,hasShiny:()=>false,preload(){}},Enemies:{bagAt:()=>bag,scale:()=>({hp:1}),upcomingDex:()=>[],BOSSES:[]},Coop:{scaleRate:()=>1,scaleHp:()=>1},Rift:{inArena:false},Judgment:{active:false},Events:{golden:false},Audio:{sfx(){}},EnemyMgr:{all:()=>all,get count(){return all.length;},bossAlive:()=>false,add:e=>all.push(e)},Enemy:class{constructor(def){Object.assign(this,def,{maxHp:100,hp:100,dmg:1,xp:1});}}};
  const c={G,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/systems/spawner.js'),'utf8'),c);
  G.Spawner.update(100,Array.from({length:n},()=>({x:0,y:0})),time);
  assert.equal(all.filter(e=>e.behavior==='healer').length,expected);assert.equal(all.filter(e=>e.behavior==='shielder').length,expected);if(!expected)assert.ok(all.every(e=>e.behavior==='chase'));
 }
});

test('原始治療半徑包含目標體積，150+r 邊界仍可受療',()=>{
 const {G,make}=fixture(),h=make({id:1,behavior:'healer',hp:500,r:10}),inside=make({id:2,x:160,r:10,hp:500}),outside=make({id:3,x:160.01,r:10,hp:500});
 for(const e of [h,inside,outside])G.EnemyMgr.add(e);G.EnemyMgr.rebuildGrid();h.healAround();assert.equal(h.hp,500);assert.equal(inside.hp,550);assert.equal(outside.hp,500);
});
