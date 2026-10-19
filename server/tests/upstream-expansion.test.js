'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8'),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){let seed=71;const math=Object.create(Math);math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 const G={U:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),pickN:(a,n)=>a.slice(0,n),TYPE_COLOR:new Proxy({},{get:()=> '#fff'}),TYPE_NAME:new Proxy({},{get:()=> 'type'})},Types:{mult:()=>1,label:()=>null},Weather:{mult:()=>1,speedFor:()=>1},FX:{dmgText(){},burst(){},ring(){}},Audio:{sfx(){}},Camera:{kick(){}},Projectiles:{clearOrbs(){}}};
 const c={G,Math:math,performance:{now:()=>100000}};vm.createContext(c);for(const p of ['js/systems/stats.js','js/entities/player.js','js/data/moves.js','js/data/items.js','js/systems/levelup.js','js/ui/bonuses.js'])vm.runInContext(read(p),c);
 const p=Object.assign(Object.create(G.Player.prototype),{mon:{name:'fixture',types:['fire','psychic'],atk:2,pa:2,sa:1,df:75,sd:75},baseAtk:2,atkMul:1,baseMaxHp:100,itemHpMul:1,hp:100,cdMul:1,baseSpd:100,spdMul:1,dmgReduce:0,itemDmgReduce:0,buffs:{atk:{n:0,amount:0},patk:{n:0,amount:0},satk:{n:0,amount:0},def:{n:0,amount:0},spd:{n:0,amount:0},regen:{n:0,amount:0}},moves:[],slots:[],active:0,statsTaken:{},maxMoves:4,banned:new Set(),anim:{play(){}},item:null,x:0,y:0,bodyH:1,invuln:0});return {G,p,c};}

test('103招與8種新增攻擊族群，18種屬性各至少5招；進化均可建立',()=>{
 const {G}=fixture();assert.equal(G.Moves.ALL.length,103);for(const kind of ['homing','bounce','charge','spin','quake','vortex','shove','stun'])assert.ok(G.Moves.ALL.some(m=>m.kind===kind));
 for(const type of new Set(G.Moves.ALL.map(m=>m.type)))assert.ok(G.Moves.ALL.filter(m=>m.type===type).length>=5,type);
 for(const d of G.Moves.ALL){const m=G.Moves.instance(d.id,5),e=G.Moves.evoInfo(m,{});if(e){G.Moves.evolve(m);assert.ok(m.evolved);assert.ok(Number.isFinite(m.dmg??0));}}
});
test('單屬性只加同屬性攻擊，生命寶珠仍1.3攻擊／0.9最大生命，學招不搶目前招式',()=>{
 const {G,p}=fixture();p.mon.types=['fire'];p.bind={};p.bonds=0;near(p.atkFor({cat:'physical',type:'fire'}),2.4);near(p.atkFor({cat:'physical',type:'water'}),2);
 p.equip('lifeorb');near(p.maxHp,90);near(p.atkFor({cat:'physical',type:'fire'}),3.12);p.addMove('ember');p.addMove('flame-charge');assert.equal(p.activeMove().id,'ember');p.equip(null);near(p.maxHp,100);p.mon.types=['fire','flying'];near(p.atkFor({cat:'physical',type:'fire'}),2);
});
function dbFixture(){const f=fixture();f.c.localStorage={getItem:()=>null,setItem(){},removeItem(){}};Object.assign(f.c,{console,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}});vm.runInContext(read('js/data/pokedex.js'),f.c);vm.runInContext(read('js/core/db.js'),f.c);vm.runInContext(read('js/data/starters.js'),f.c);vm.runInContext(read('js/data/upgrades.js'),f.c);f.G.DB.playAsGuest();return f;}
test('初始招式400幣一次解鎖；可達鴨保留念力、拒絕增益／異屬性／未購買，選回預設不被舊存檔復活',()=>{
 const {G}=dbFixture(),d=G.DB;d.save.owned[54]={at:1};assert.ok(G.startChoices(54).includes('confusion'));assert.ok(!G.startChoices(54).includes('nasty-plot'));assert.equal(d.setStartMove(54,'water-gun'),false);d.upgradesOf(54).start=1;
 assert.equal(G.Upgrades.cost('start',0),400);assert.equal(G.Upgrades.BY.start.max,1);assert.equal(d.setStartMove(54,'water-gun'),true);assert.equal(G.startMoveOf(54),'water-gun');d.save.pban={54:['confusion','bubble']};const old=JSON.parse(JSON.stringify(d.save));assert.equal(d.setStartMove(54,'confusion'),true);assert.equal(G.startMoveOf(54),'confusion');assert.ok(!d.save.pban[54].includes('confusion'));
 const merged=d.merge(d.save,old);assert.equal(merged.pstart[54].id,'confusion');assert.equal(d.merge(old,d.save).pstart[54].id,'confusion');assert.equal(d.setStartMove(54,'ember'),false);assert.equal(d.setStartMove(54,'nasty-plot'),false);
});
test('初始招式選擇合併保留最愛／儲備，不接受原型、未知招式與非法時間',()=>{
 const {G}=dbFixture(),d=G.DB;d.toggleFavorite(1);d.upgradesOf(1).moves=1;d.setReserveEnabled(1,false);const a=JSON.parse(JSON.stringify(d.save)),b=JSON.parse(JSON.stringify(a));b.pstart=JSON.parse('{"__proto__":{"id":"ember","at":2},"1":{"id":"fake","at":5},"54":{"id":"water-gun","at":-1}}');const merged=d.merge(a,b);assert.equal(Object.keys(merged.pstart).length,0);assert.ok(merged.favorites[1].on);assert.equal(merged.moveReserve[1].enabled,false);
});
test('暈眩多人事件傳入上限內資料，無法傳入非數值或無限大',()=>{
 const G={};vm.runInNewContext(read('js/net/protocol.js'),{G,TextEncoder});const p=[0,0,0,0,100,100,0,'thunder-wave',1,1,0,0,0];assert.ok(G.NetProtocol.message({k:'f',p,ev:[['s',1,'t',1]]},false));assert.equal(G.NetProtocol.message({k:'f',p,ev:[['s',1,'t',Infinity]]},false),false);assert.equal(G.NetProtocol.message({k:'f',p,ev:[['s',1,'t',10000]]},false),false);
});

function combatFixture(){const shots=[],foe={id:1,x:30,y:0,r:10,bodyH:1,types:['normal'],dead:false,touchCd:1,mon:{},hurt(d){this.received=(this.received||0)+d;},applyStun(t){this.stunT=t;}};
 const noop=()=>{},G={U:{TYPE_COLOR:new Proxy({},{get:()=> '#fff'}),norm:(x,y)=>[x/(Math.hypot(x,y)||1),y/(Math.hypot(x,y)||1)],dist:(x,y,a,b)=>Math.hypot(x-a,y-b),dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),rand:()=>0},LIFT:0,FX:new Proxy({withAttack:fn=>fn()},{get:(o,k)=>o[k]||noop}),VFX:{forMove:()=>({})},World:{propsInCircle:()=>[],projectileBlock:()=>null,isWall:()=>false},EnemyMgr:{all:()=>[foe],queryCircle:()=>[foe]},Projectiles:{all:()=>shots,spawn:p=>shots.push({...p,friendly:true,hits:new Set(),hitLog:new Map()}),nearest:()=>foe},Types:{mult:()=>1,label:()=>null},Weather:{mult:()=>1},Coop:{active:false},Stats:{taken:()=>1},Camera:{sees:()=>false,kick:noop},Audio:{sfx:noop},Settings:{get:()=>0}};
 const c={G,performance:{now:()=>10}};vm.runInNewContext(read('js/data/moves.js'),c);vm.runInNewContext(read('js/systems/combat.js'),c);return {G,shots,foe};}
test('8種新增攻擊實際施放／更新；暈眩頭目縮短、吸血固定1點、幽靈場不造成傷害',()=>{
 for(const id of ['energy-ball','seed-bomb','hyper-beam','rapid-spin','magnitude','whirlpool','whirlwind','thunder-wave']){
  const {G,foe}=combatFixture(),m=G.Moves.instance(id),p={x:0,y:0,r:5,aim:0,cdMul:1,dead:false,activeGroup:()=>[m],atkFor:()=>1,target:foe,cast(){},onDealt(){},dmgDealt:0};
  G.Combat.tick(.1,p,0);G.Combat.updateFields(1);assert.ok(G.Combat.fieldCount>=0);if(['rapid-spin','magnitude','whirlpool','whirlwind','thunder-wave'].includes(id))assert.ok(foe.received>0,id);
 }
 for(const boss of [false,true]){const {G,foe}=combatFixture();foe.boss=boss;const m=G.Moves.instance('thunder-wave'),p={x:0,y:0,r:1,aim:0,cdMul:1,target:foe,atkFor:()=>1,activeGroup:()=>[m],cast(){},onDealt(){},dmgDealt:0};G.Combat.tick(.1,p,0);G.Combat.updateFields(.5);near(foe.stunT,boss?.35:1);}
 {const {G,foe}=combatFixture(),p={x:0,y:0,r:1,aim:0,target:foe,cast(){},atkFor:()=>1};G.Combat.ghostCast(p,'thunder-wave',1,0,false);G.Combat.updateFields(.5);assert.equal(foe.received,undefined);assert.equal(foe.stunT,undefined);}
 {const {G,foe,shots}=combatFixture(),m=G.Moves.instance('draining-kiss');let heal=0;const p={x:0,y:0,r:1,aim:0,cdMul:1,target:foe,atkFor:()=>1,activeGroup:()=>[m],cast(){},onDealt(){},heal:n=>heal+=n,dmgDealt:0};G.Combat.tick(.1,p,0);for(const shot of shots){shot.x=foe.x;shot.y=foe.y;}G.Combat.resolve(.1,p,0);assert.equal(heal,1);}
});
test('暱稱碰巧等於翻譯詞時不改名，普通動態內容仍翻譯且優先具體模板',()=>{
 function Canvas(){};Canvas.prototype.fillText=function(s){return s;};Canvas.prototype.strokeText=Canvas.prototype.measureText=Canvas.prototype.fillText;
 const G={},c={G,CanvasRenderingContext2D:Canvas,localStorage:{getItem:()=> 'zh-TW'},navigator:{language:'zh-TW'},location:{pathname:'/zh-TW/'},document:{documentElement:{}},window:{confirm:s=>s,alert:s=>s}};vm.runInNewContext(read('js/core/i18n.js'),c);G.I18n.add({'Fuego':'火','Solicitud enviada a {x}':'已向{x}送出申請','Nivel {x}':'等級{x}'},'zh-TW');assert.equal(G.T('Solicitud enviada a Fuego'),'已向Fuego送出申請');assert.equal(G.T('Nivel Fuego'),'等級火');assert.equal(G.I18n.rawCanvas(new Canvas(),'fillText','Fuego'),'Fuego');
});
test('初始招式存檔後端接受受限格式，拒絕不合法欄位及時間',async()=>{
 const {authorize}=require('../policy');const doc={save:{coins:10,tickets:{},pstart:{1:{id:'ember',at:1}}},v:3};await authorize({},'saves/u',null,doc,'u');for(const entry of [{id:'<script>',at:1},{id:'ember',at:-1},{id:'ember',at:1,token:'x'}])await assert.rejects(()=>authorize({},'saves/u',null,{...doc,save:{...doc.save,pstart:{1:entry}}},'u'));
});

test('遠處頭目超過4秒才移回，距離門檻及制裁／裂隙例外保留',()=>{
 const G={U:{dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2},Coop:{active:true,isHost:false},Rift:{inArena:false},Camera:{sees:()=>false},Spawner:{ahead(e){e.x=100;e.y=0;e.relocated=true;}}};vm.runInNewContext(read('js/entities/enemy.js'),{G,performance:{now:()=>0}});
 const e={id:1,x:3000,y:0,r:1,boss:true,judge:false,dead:false,lagT:0,update(){}};G.EnemyMgr.add(e);const players=[{x:0,y:0,dead:false}];G.EnemyMgr.update(4,players);assert.equal(e.relocated,undefined);G.EnemyMgr.update(.01,players);assert.ok(e.relocated);
 for(const mode of ['arena','judge','near']){e.relocated=false;e.x=mode==='near'?2500:3000;e.lagT=0;e.judge=mode==='judge';G.Rift.inArena=mode==='arena';G.EnemyMgr.update(10,players);assert.equal(e.relocated,false,mode);}
});
