'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
function fixture(){
 const G={Game:{st:{time:0},everyone:()=>[{atk:1,baseAtk:1}]},U:{dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))},World:{isWall:()=>false},FX:{burst(){},ring(){},dmgText(){}},Coop:{isHost:false,hit(){}},Camera:{sees:()=>false},Audio:{sfx(){}},Judgment:{noteDmg(){}}};
 const c={G,console};vm.createContext(c);vm.runInContext(read('js/entities/enemy.js'),c);
 const make=(extra={})=>Object.assign(Object.create(G.Enemy.prototype),{id:1,x:0,y:0,r:10,hp:1000,maxHp:1000,shield:0,shieldT:0,rd:0,bodyH:20,behavior:'chase',bob:0,anim:{play(){},update(){}},showHurt(){},die(){this.dead=true;}},extra);return {G,make};
}
test('原作一般治療7～17.5%依攻擊倍率成長，允許自療及跨來源重複治療',()=>{
 for(const [power,rate] of [[1,.07],[2,.07*2**.35],[100,.175]]){const {G,make}=fixture(),a=make({hp:100}),h=make({hp:100,behavior:'healer'});G.Game.everyone=()=>[{atk:power,baseAtk:1}];G.EnemyMgr={queryCircle:()=>[a,h]};h.healAround();assert.ok(Math.abs(a.hp-(100+1000*rate))<1e-8);assert.ok(h.hp>100);make().healAround();assert.ok(a.hp>100+1000*rate);}
});
test('頭目回血按近期DPS×0.4封頂，普通敵人仍按百分比；不回血已死亡／滿血目標',()=>{
 const {G,make}=fixture(),h=make(),boss=make({hp:100,maxHp:100000,boss:true,rd:6000}),normal=make({hp:100,maxHp:100000}),dead=make({hp:100,dead:true});G.EnemyMgr={queryCircle:()=>[boss,normal,dead]};h.healAround();assert.equal(boss.hp,500);assert.ok(Math.abs(normal.hp-7100)<1e-8);assert.equal(dead.hp,100);boss.rd=0;h.healAround();assert.equal(boss.hp,500);
});
test('原作普通護盾35%、可自盾；最近六個目標，頭目護盾DPS×1.2且共享6秒補盾間隔',()=>{
 const {G,make}=fixture(),h=make(),boss=make({id:2,boss:true,maxHp:100000,rd:6000}),other=make({id:3});const targets=[h,boss,other,...Array.from({length:6},(_,i)=>make({id:i+4,x:10+i}))];G.EnemyMgr={queryCircle:()=>targets};h.castShields();assert.equal(h.shield,350);assert.equal(boss.shield,1200);assert.equal(targets.filter(e=>e.shield>0).length,6);
 boss.shield=0;boss.shieldT=2.01;h.castShields();assert.equal(boss.shield,0);boss.shieldT=2;h.castShields();assert.equal(boss.shield,1200);
});
test('打到護盾仍計入頭目近期傷害，完整吸收時不減生命；遠端命中轉送主機',()=>{
 const {G,make}=fixture(),e=make({boss:true,shield:100});e.hurt(20);assert.equal(e.shield,80);assert.equal(e.hp,1000);assert.equal(e.rd,20);let hit=0;G.Coop.hit=()=>hit++;const remote=make({remote:true,boss:true});remote.hurt(20);assert.equal(hit,1);assert.equal(remote.rd,0);
});
test('生成上限：單人與四人均治療、護盾、召喚者各三隻，沒有額外開場60秒排除',()=>{
 for(const n of [1,4]){const all=[],bag=['healer','shielder','summoner','chase'].map((behavior,i)=>({dex:i+1,behavior}));const G={U:{pick:a=>a[0],rand:a=>a,dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},Camera:{outerRadius:()=>100},World:{isFree:()=>true},Sprites:{hovers:()=>false,hasShiny:()=>false,preload(){}},Enemies:{bagAt:()=>bag,scale:()=>({hp:1}),upcomingDex:()=>[],BOSSES:[]},Coop:{scaleRate:()=>1,scaleHp:()=>1},Rift:{inArena:false},Judgment:{active:false},Events:{golden:false},Audio:{sfx(){}},EnemyMgr:{all:()=>all,get count(){return all.length;},bossAlive:()=>false,add:e=>all.push(e)},Enemy:class{constructor(def){Object.assign(this,def,{maxHp:100,hp:100,dmg:1,xp:1});}}};vm.runInNewContext(read('js/systems/spawner.js'),{G});G.Spawner.update(100,Array.from({length:n},()=>({x:0,y:0})),0);for(const kind of ['healer','shielder','summoner'])assert.equal(all.filter(e=>e.behavior===kind).length,3);}
});
test('中毒有效血量：六萬以下不變、24萬為12萬、600萬為60萬',()=>{
 const source=read('js/entities/enemy.js');const formula=source.match(/const PCT_REF = [\s\S]*?const pctHp = [^;]+;/)[0];const calc=vm.runInNewContext('(()=>{'+formula+'return hp=>pctHp({maxHp:hp});})()');for(const [hp,value] of [[1000,1000],[60000,60000],[240000,120000],[6000000,600000]])assert.equal(calc(hp),value);
});
test('制裁速度軟上限與37→40分鐘觸碰成長；35分鐘以前不額外加速',()=>{
 const G={};vm.runInNewContext(read('js/systems/judgment.js'),{G});for(const [speed,value] of [[100,100],[130,130],[170,140],[250,160],[290,170]])assert.equal(G.Judgment.capSpd(speed),value);
 const source=read('js/systems/judgment.js'),fn=source.match(/const touchPct = [^;]+;/)[0],calc=vm.runInNewContext('(()=>{const TOUCH=.4;let arenaT=0;'+fn+'return t=>{arenaT=t;return touchPct();};})()');for(const [time,rate] of [[0,.4],[420,.4],[480,.6],[540,.8],[600,1],[900,1]])assert.ok(Math.abs(calc(time)-rate)<1e-9);
});
