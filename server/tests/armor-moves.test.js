 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
function fixture(){const G={U:{pickN:(a,n)=>a.slice(0,n),TYPE_COLOR:new Proxy({},{get:()=> '#fff'}),TYPE_NAME:new Proxy({},{get:()=> 'type'})},Audio:{sfx(){}},Camera:{kick(){}},FX:{dmgText(){},burst(){},ring(){}},Projectiles:{clearOrbs(){}},Types:{mult:()=>.5,label:()=>null},Weather:{mult:()=>1,speedFor:()=>1},World:{liquidEffect:()=>({})},Progress:{event(){}}};const c={G,performance:{now:()=>100000}};vm.createContext(c);for(const file of ['js/entities/player.js','js/data/items.js','js/data/moves.js','js/systems/levelup.js','js/ui/bonuses.js'])vm.runInContext(read(file),c);
 const p=Object.assign(Object.create(G.Player.prototype),{mon:{hp:100,types:['normal']},maxHp:1000,hp:1000,dmgReduce:0,itemDmgReduce:0,baseAtk:1,atkMul:1,baseSpd:100,spdMul:1,cdMul:1,regenFlat:0,xpMul:1,coinMul:1,magnet:78,critChance:0,buffs:{atk:{n:0,amount:0},spd:{n:0,amount:0},def:{n:0,amount:0},regen:{n:0,amount:0}},item:null,slots:[],moves:[],active:0,maxMoves:4,statsTaken:{},banned:new Set(),anim:{play(){}},invuln:0,bodyH:1,x:0,y:0});return {G,p,c};}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('加點與穿脫背心不倒扣，先後順序與重複裝備一致',()=>{
 const {G,p}=fixture(),def=G.LevelUp.STATS.find(s=>s.id==='def');p.dmgReduce=.6;p.equip('assaultvest');near(p.reduction,.8);def.apply(p);near(p.dmgReduce,.66);near(p.reduction,.86);p.equip(null);near(p.reduction,.66);
 for(let i=0;i<20;i++){p.equip('assaultvest');p.equip('assaultvest');p.equip('lifeorb');p.equip(null);}near(p.dmgReduce,.66);near(p.itemDmgReduce,0);
 const q=fixture();q.p.dmgReduce=.6;q.G.LevelUp.STATS.find(s=>s.id==='def').apply(q.p);q.p.equip('assaultvest');p.equip('assaultvest');near(p.reduction,q.p.reduction);
});
test('防禦與近戰合計最高 90%，傷害、面板及選卡預估共用有效值',()=>{
 const {G,p}=fixture();p.dmgReduce=.69;p.equip('assaultvest');p.slots=[[{kind:'melee'}]];p.buffs.def={n:5,amount:.07};near(p.reduction,.9);near(p.effectiveReduction,.9);
 p.hurt(100);near(p.hp,990);assert.equal(G.Bonuses.rows(p).find(r=>r.id==='def').value,'90.0%');assert.match(G.Bonuses.cardSummary({key:'stat:def'},p),/90.0% → 90.0%/);near(p.dmgReduce,.69);
 p.buffs.def.n=0;p.equip(null);near(p.reduction,.69);near(p.effectiveReduction,.7675);
});
test('相剋仍先算；純粹傷害跳過減傷，普通最低傷害 1',()=>{
 const {p}=fixture();p.dmgReduce=.7;p.itemDmgReduce=.2;p.hurt(100,'water');near(p.hp,995);p.invuln=0;p.hurt(100,null,true);near(p.hp,895);p.invuln=0;p.hurt(1);near(p.hp,894);
});
test('本體達 70% 不再提供護甲卡，臨時效果結束不改本體',()=>{
 const {G,p}=fixture();p.dmgReduce=.7;p.slots=Array.from({length:4},()=>[]);p.moves=[];p.statsTaken={def:0};for(let i=0;i<30;i++)assert.ok(!G.LevelUp.offer(p,50).some(c=>c.key==='stat:def'));G.LevelUp.STATS.find(s=>s.id==='def').apply(p);near(p.dmgReduce,.7);
});
test('可學池依屬性固定，每次升級重抽候選而非場次鎖定，滿欄停止新招',()=>{
 const {G,p}=fixture();assert.equal(G.Moves.ALL.length,64);assert.equal(G.Moves.poolFor({types:['electric']}).length,11);assert.ok(!G.Moves.poolFor({types:['electric']}).includes('flamethrower'));
 p.mon.types=['fire','flying'];const eligible=G.Moves.poolFor(p.mon);const seen=new Set();let offset=0;G.U.pickN=(a,n)=>{if(a.length===eligible.length){const out=Array.from({length:Math.min(n,a.length)},(_,i)=>a[(i+offset)%a.length]);offset+=6;return out;}return a.slice(0,n);};
 for(let i=0;i<4;i++)for(const c of G.LevelUp.offer(p,100))if(c.type==='new')seen.add(c.key.slice(4));assert.equal(seen.size,eligible.length);
 p.slots=Array.from({length:4},()=>[]);assert.ok(!G.LevelUp.offer(p,100).some(c=>c.type==='new'));
});
test('排除清單與兩個增益招式限制生效；招式升滿五級後停止一般強化',()=>{
 const {G,p}=fixture();p.mon.types=['normal'];p.banned.add('tackle');p.moves=G.Moves.ALL.filter(m=>m.kind==='buff').slice(0,2).map(m=>G.Moves.instance(m.id));p.slots=p.moves.map(m=>[m]);const cards=G.LevelUp.offer(p,100);
 assert.ok(!cards.some(c=>c.key==='new:tackle'));assert.ok(cards.filter(c=>c.type==='new').every(c=>G.Moves.BY_ID[c.key.slice(4)].kind!=='buff'));
 const move=G.Moves.instance('tackle');for(let i=0;i<4;i++)G.Moves.levelUp(move);assert.equal(move.lvl,5);assert.equal(G.Moves.nextUpText(move),null);
});

test('護甲、背心、變硬與近戰組合不會因加點倒扣，移除只影響該來源',()=>{
 for(const base of [0,.16,.6,.69,.7])for(const item of [false,true])for(const stacks of [0,1,5])for(const melee of [false,true]){
  const {G,p}=fixture();p.dmgReduce=base;p.buffs.def={n:stacks,amount:.07};p.slots=melee?[[{kind:'melee'}]]:[];if(item)p.equip('assaultvest');const before=p.effectiveReduction;G.LevelUp.STATS.find(s=>s.id==='def').apply(p);assert.ok(p.effectiveReduction+1e-9>=before);assert.ok(p.effectiveReduction<=.9);p.equip(null);p.buffs.def.n=0;near(p.reduction,p.dmgReduce);near(p.effectiveReduction,melee?1-(1-p.dmgReduce)*.75:p.dmgReduce);
 }
});
test('預設使用 Cubic，已明確選平滑的使用者保留原選擇',()=>{
 for(const [stored,expected] of [[null,'pixel'],[JSON.stringify({fontStyle:'smooth'}),'smooth']]){
  const c={G:{},console,document:{documentElement:{dataset:{}}},localStorage:{getItem:()=>stored,setItem(){}},matchMedia:()=>({matches:false})};vm.createContext(c);vm.runInContext(read('js/core/settings.js'),c);assert.equal(c.G.Settings.get('fontStyle'),expected);assert.equal(c.document.documentElement.dataset.font,expected);
 }
});

test('連結可釋出新招式欄位，正常連結流程上限十三招；進化不另佔欄位',()=>{
 const {G,p}=fixture();p.mon.types=['fire','grass'];p.bind={};p.bonds=100;p.setActive=i=>{p.active=i;};let buffs=0;const ids=G.Moves.poolFor(p.mon).filter(id=>G.Moves.BY_ID[id].kind!=='buff'||buffs++<2);let i=0;
 while(i<ids.length){if(p.addMove(ids[i])){i++;continue;}const o=p.bondOptions();if(!o)break;p.fuse(o.mode==='add'?[o.loose[0]]:[o.loose[0],o.loose[1]],o.group);}
 assert.equal(p.moves.length,13);assert.equal(p.slots.length,4);assert.deepEqual(Array.from(p.slots,s=>s.length).sort(),[1,4,4,4]);
 const m=G.Moves.instance('tackle',5),n=p.slots.length;assert.equal(G.Moves.evoInfo(m,{}).ready,false);assert.equal(G.Moves.evoInfo(m,{hp:1}).ready,true);G.Moves.evolve(m);assert.equal(p.slots.length,n);assert.equal(m.lvl,5);assert.equal(G.Moves.nextUpText(m),null);
});

test('實際變硬從一級到五級疊層與升級不降低效果，滿級仍封頂 90%',()=>{
 const {G,p}=fixture();const m=G.Moves.instance('harden');let previous=0;
 for(let level=1;level<=5;level++){
  for(let i=0;i<m.stacks;i++){p.addBuff(m.stat,m.amount,m.dur,m.stacks);assert.ok(p.effectiveReduction+1e-9>=previous);assert.ok(p.effectiveReduction<=.9);previous=p.effectiveReduction;}
  if(level<5)G.Moves.levelUp(m);
 }
 assert.equal(m.stacks,7);near(p.effectiveReduction,.9);p.buffs.def.n=0;near(p.effectiveReduction,0);near(p.dmgReduce,0);
});
