'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const G={U:{pick:xs=>xs[0]},Audio:{sfx(){}},Camera:{kick(){}},Sprites:{animMeta:()=>null},FX:{dmgText(){},burst(){},ring(){}},Projectiles:{clearOrbs(){}},Types:{mult:()=>1,label:()=>null},Weather:{mult:()=>1,speedFor:()=>1},World:{liquidEffect:()=>({})}};
 const scope={G,performance:{now:()=>100000}};vm.createContext(scope);
 for(const file of ['js/entities/player.js','js/data/items.js','js/ui/bonuses.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),scope);
 const p=Object.assign(Object.create(G.Player.prototype),{maxHp:100,hp:50,item:null,baseAtk:10,atkMul:1,dmgReduce:0,baseSpd:100,spdMul:1,cdMul:1,buffs:{atk:{n:0,amount:0},def:{n:0,amount:0},spd:{n:0,amount:0},regen:{n:0,amount:0}},mon:{hp:100,types:['normal']},slots:[],anim:{busy:()=>false,play(){}},bodyH:1,x:0,y:0});return {G,p};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('生命寶珠 +30% 攻擊、-10% 最大生命，裝卸維持生命比例且不能反覆回血',()=>{
 const {p}=fixture();for(let i=0;i<1000;i++){
  p.equip('lifeorb');near(p.maxHp,90);near(p.hp,45);near(p.atk,13);
  p.equip('lifeorb');near(p.hp,45);near(p.atk,13);
  p.equip(null);near(p.maxHp,100);near(p.hp,50);near(p.atk,10);
 }
});
test('生命加點在寶珠期間也承擔 10% 代價，預估不改動本人，卸下恢復正確來源',()=>{
 const {G,p}=fixture();p.equip('lifeorb');G.LevelUp={STATS:[{id:'hp',apply:pl=>pl.addMaxHp(20)}]};
 assert.match(G.Bonuses.cardSummary({key:'stat:hp'},p),/90 → 108/);near(p.hp,45);near(p.maxHp,90);
 p.addMaxHp(20);near(p.maxHp,108);near(p.hp,63);p.equip(null);near(p.maxHp,120);near(p.hp,70);
});
test('連續施放、多段與增益不再扣血，極低血量裝卸不致死、不額外補血',()=>{
 const {p}=fixture();p.hp=1;p.equip('lifeorb');near(p.hp,.9);
 for(let i=0;i<100;i++)for(const kind of ['projectile','buff','orbit','trail','chain'])p.cast({kind,cd:.1});
 near(p.hp,.9);p.equip(null);near(p.hp,1);p.hp=0;p.dead=true;p.equip('lifeorb');assert.equal(p.hp,0);assert.equal(p.dead,true);
});
test('相同防禦下承傷仍受減傷，治療封頂降低後最大生命；換其他道具不殘留寶珠來源',()=>{
 const {p}=fixture();p.hp=100;p.dmgReduce=.9;p.equip('lifeorb');near(p.hp,90);p.hurt(100);near(p.hp,70);
 p.heal(100);near(p.hp,90);p.equip('assaultvest');near(p.maxHp,100);near(p.atk,10);near(p.itemDmgReduce,.2);
 p.equip('lifeorb');near(p.maxHp,90);near(p.itemDmgReduce,0);near(p.atk,13);
});
