'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../..');
function fixture(){
 const G={Game:{st:{time:0}},U:{dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},World:{isWall:()=>false},FX:{burst(){},ring(){},dmgText(){}},Coop:{isHost:false},Camera:{sees:()=>false},Audio:{sfx(){}},Judgment:{noteDmg(){}}};
 const c={G,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/entities/enemy.js'),'utf8'),c);
 const make=(extra={})=>Object.assign(Object.create(G.Enemy.prototype),{id:1,x:0,y:0,hp:1000,maxHp:1000,shield:0,bodyH:20,behavior:'chase',anim:{play(){}},showHurt(){},die(){this.dead=true;}},extra);
 return {G,make};
}
test('有效傷害排除過量傷害，護盾吸收也列入；訪客不能累計預算',()=>{
 const {make,G}=fixture(),a=make({hp:50,shield:10});a.hurt(1000);assert.equal(a.supportDamage,60);
 const b=make({shield:100});b.hurt(20);assert.equal(b.supportDamage,20);assert.equal(b.hp,1000);
 G.Coop.hit=()=>{};const c=make({remote:true});c.hurt(20);assert.equal(c.supportDamage,undefined);assert.equal(c.receiveSupport('shield',1),0);
});
test('治療者不再依玩家攻擊縮放，同目標 5 秒共用一次，上限 4%',()=>{
 const {G,make}=fixture(),a=make({hp:500,supportDamage:500}),h1=make({behavior:'healer'}),h2=make({behavior:'healer'});
 G.EnemyMgr.queryCircle=()=>[a,h1,h2];h1.healAround();assert.equal(a.hp,540);h2.healAround();assert.equal(a.hp,540);
 G.Game.st.time=4.999;h2.healAround();assert.equal(a.hp,540);G.Game.st.time=5;h2.healAround();assert.equal(a.hp,580);
});
test('自療／治療者互補／頭目／傳說／制裁排除，最多五個目標且不能隔牆',()=>{
 const {G,make}=fixture(),targets=Array.from({length:8},(_,i)=>make({id:i+1,hp:500,supportDamage:500}));
 const special=['boss','legend','judge'].map(k=>make({[k]:true,hp:500,supportDamage:500}));const h=make({behavior:'healer',hp:500,supportDamage:500});
 G.EnemyMgr.queryCircle=()=>[h,...special,...targets];h.healAround();assert.equal(targets.filter(e=>e.hp>500).length,5);assert.equal(h.hp,500);assert.ok(special.every(e=>e.hp===500));
 G.Game.st.time=10;G.World.isWall=()=>true;for(const e of targets)e.x=80;h.healAround();assert.ok(targets.every(e=>e.hp<=540));
});
test('護盾首次 10%，後續護盾與回血共用 30% 預算，換支援者不重置',()=>{
 const {make}=fixture(),a=make();assert.equal(a.receiveSupport('shield',0),100);assert.equal(a.receiveSupport('shield',0),0);
 a.hurt(50);assert.equal(a.receiveSupport('shield',1),15);assert.equal(a.supportRestored,15);assert.equal(a.receiveSupport('shield',2),0);
 a.shield=0;a.hurt(100);assert.equal(a.receiveSupport('heal',5),30);assert.equal(a.supportRestored,45);assert.equal(a.receiveSupport('shield',6),0);
});
test('十個支援來源持續回復，固定低輸出仍會擊殺；預算不超過 30%',()=>{
 const {make}=fixture(),a=make();a.receiveSupport('shield',0);
 let t=0;for(;t<2000&&!a.dead;t++){a.hurt(1);if(a.dead)break;for(let j=0;j<10;j++){a.receiveSupport('shield',t);a.receiveSupport('heal',t);}assert.ok((a.supportRestored||0)<=a.supportDamage*.3+1e-8);}
 assert.equal(a.dead,true);assert.ok(t<1600);
});
test('生成器：前 120 秒排除治療與護盾，單人最多一隻、合作最多兩隻治療者',()=>{
 for(const [n,time,expected] of [[1,119,0],[1,120,1],[4,120,2]]){
  const all=[],bag=[{dex:1,behavior:'healer'},{dex:2,behavior:'shielder'},{dex:3,behavior:'chase'}];
  const G={U:{pick:a=>a[0],rand:a=>a,dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},Camera:{outerRadius:()=>100},World:{isFree:()=>true},Sprites:{hovers:()=>false,hasShiny:()=>false,preload(){}},Enemies:{bagAt:()=>bag,scale:()=>({hp:1}),upcomingDex:()=>[],BOSSES:[]},Coop:{scaleRate:()=>1,scaleHp:()=>1},Rift:{inArena:false},Judgment:{active:false},Events:{golden:false},EnemyMgr:{all:()=>all,get count(){return all.length;},bossAlive:()=>false,add:e=>all.push(e)},Enemy:class{constructor(def){Object.assign(this,def,{maxHp:100,hp:100,dmg:1,xp:1});}}};
  const c={G,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'js/systems/spawner.js'),'utf8'),c);
  G.Spawner.update(10,Array.from({length:n},()=>({x:0,y:0})),time);
  assert.equal(all.filter(e=>e.behavior==='healer').length,expected);if(!expected)assert.ok(all.every(e=>e.behavior==='chase'));
 }
});
