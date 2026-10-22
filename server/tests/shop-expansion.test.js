'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
function fixture(){
  const store=new Map(),G={I18n:{lang:'zh-TW'},T:s=>s,Audio:{sfx(){}},FX:{ring(){},dmgText(){},burst(){}},Camera:{kick(){}},Settings:{get:()=>false},Sprites:{hasShiny:()=>false,playerScale:()=>1,playerRadius:()=>9,bodyHeight:()=>20,Animator:class{loop(){}play(){}}},Types:{mult:()=>1,label:()=>''},Weather:{mult:()=>1,speedFor:()=>1},Coop:{active:false},Judgment:{active:false},World:{liquidEffect:()=>({})}};
  const c={G,console,crypto:webcrypto,TextEncoder,TextDecoder,performance:{now:()=>100000},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},btoa:s=>Buffer.from(s,'binary').toString('base64')};
  c.window={G};c.location={protocol:"file:"};vm.createContext(c);
  for(const f of ['js/core/util.js','js/data/pokedex.js','js/data/natures.js','js/data/abilities.js','js/data/tms.js','js/data/moves.js','js/systems/stats.js','js/data/upgrades.js','js/data/items.js','js/core/db.js','js/data/starters.js','js/data/shop.js','js/systems/mons.js','js/data/ability-fx.js','js/entities/player.js'])vm.runInContext(read(f),c);
  G.DB.playAsGuest();G.DB.save.owned={1:{at:1},25:{at:1}};G.DB.save.partner=1;return {G,c};
}
test('性格與特性固定到帳號／種族，繁中語系使用官方名稱，性格不修改原始圖鑑',()=>{
  const {G}=fixture();assert.equal(G.NATURES.length,25);assert.equal(Object.keys(G.ABIL).length,271);
  G.DB.save.created=123;const first=G.Mons.natureOf(25).id;assert.equal(G.Mons.natureOf(25).id,first);
  G.Mons.setNature(25,'adamant');const m=G.Mons.monFor(25),base=G.DEX_BY[25];assert.equal(m.pa,base.pa*1.1);assert.equal(m.sa,base.sa*.9);assert.equal(base.nature,undefined);assert.equal(G.Mons.name(G.NATURE_BY.adamant.n),'固執');
  assert.equal(G.Mons.abilityName('static'),'靜電');assert.ok(G.Mons.abilityChoices(25,true).length>0);
});
test('商店價格、每日八項、購買扣款與庫存上限，金額不足與滿格不扣錢',()=>{
  const {G}=fixture(),s=G.DB.save;s.coins=10000;assert.equal(G.Shop.ITEMS.mint.price,1500);assert.equal(G.Shop.ITEMS.caph.price,5000);
  assert.equal(G.Shop.dailyTms().length,8);assert.equal(new Set(G.Shop.dailyTms()).size,8);assert.equal(JSON.stringify(G.Shop.dailyTms()),JSON.stringify(G.Shop.dailyTms()));
  assert.equal(G.Shop.buy('mint').ok,true);assert.equal(s.coins,8500);assert.equal(G.Shop.count('mint'),1);assert.equal(G.Shop.take('mint'),true);assert.equal(G.Shop.take('mint'),false);
  s.bag.mint=999;assert.equal(G.Shop.buy('mint').ok,false);assert.equal(s.coins,8500);s.coins=0;assert.equal(G.Shop.buy('caph').ok,false);
});
test('招式學習器遵守物種學習條件，永久擴池、只消耗一次且不重複教授',()=>{
  const {G}=fixture(),s=G.DB.save;const id=G.Mons.learnable(150)[0];assert.ok(id);s.tms[id]=1;
  assert.equal(G.Mons.teach(150,id),true);assert.equal(G.Shop.tmCount(id),0);assert.ok(G.Moves.poolFor(G.DEX_BY[150]).includes(id));assert.equal(G.Mons.teach(150,id),false);assert.equal(G.Mons.canLearn(54,'flamethrower'),false);
});
test('第二初始招式需先購買儲備與解鎖，回復隨機不被舊選擇復活',()=>{
  const {G}=fixture(),s=G.DB.save,id=G.startChoices(1).find(x=>x!==G.startMoveOf(1));assert.ok(id);assert.equal(G.DB.setStartMove2(1,id),false);
  G.DB.upgradesOf(1).moves=1;G.DB.upgradesOf(1).start2=1;assert.equal(G.DB.setStartMove2(1,id),true);assert.equal(G.startMove2Of(1),id);const old=JSON.parse(JSON.stringify(s));
  assert.equal(G.DB.setStartMove2(1,''),true);assert.equal(G.startMove2Of(1),null);const merged=G.DB.merge(s,old);assert.equal(merged.pstart2[1].id,'');assert.equal(G.DB.setStartMove2(1,G.startMoveOf(1)),false);
});
test('消耗品帳本合併：用掉的薄荷與MT不復活，合併具交換性及冪等性',async()=>{
  const {G}=fixture();assert.equal((await G.DB.register('ShopPlayer','test-password')).ok,true);const s=G.DB.save;s.coins=10000;s.bag.mint=1;s.tms['shadow-ball']=1;G.DB.commit();const old=JSON.parse(JSON.stringify(s));
  G.Shop.take('mint');G.Shop.takeTm('shadow-ball');G.DB.commit();const current=JSON.parse(JSON.stringify(s));
  const merged=G.DB.merge(current,old);assert.equal(merged.bag.mint,undefined);assert.equal(merged.tms['shadow-ball'],undefined);assert.equal(JSON.stringify(merged.bag),JSON.stringify(G.DB.merge(old,current).bag));assert.equal(JSON.stringify(merged.tms),JSON.stringify(G.DB.merge(merged,current).tms));
});
test('生命寶珠與特性不互相倒扣；原作防禦特性生效；經驗異常與單次工作量受限',()=>{
  const {G}=fixture(),p=new G.Player(G.Mons.monFor(1));p.setAbility('schooling');const full=p.maxHp;p.equip('lifeorb');assert.equal(p.maxHp,full*.9);p.equip(null);assert.equal(p.maxHp,full);
  p.setAbility('thick-fat');p.hp=p.maxHp;p.invuln=0;p.hurt(10,'fire',false,'physical');assert.ok(p.hp>p.maxHp-10);
  const level=p.level;assert.equal(p.gainXp(Infinity),0);assert.equal(p.level,level);assert.equal(p.gainXp(-1),0);assert.equal(p.gainXp(1e12),50);assert.ok(p.xp>0);
});
test('商店存檔後端拒絕非法特性、性格、庫存、物種不相容MT與多餘欄位',()=>{
  const {validShopSave}=require('../shop-policy');assert.ok(validShopSave({bag:{mint:1},pnat:{25:['adamant',1]},pabil:{25:[0,1]},pstart2:{25:{id:'',at:1}}}));
  for(const bad of [{bag:{mint:1000}},{bag:{token:1}},{pnat:{25:['constructor',1]}},{pabil:{25:[99,1]}},{ptm:{54:['flamethrower']}},{pstart2:{25:{id:'ember',at:1,extra:true}}}])assert.equal(validShopSave(bad),false);
});
test('二進位編碼無損往返，拒絕畸形封包，玩家觀戰欄位及圓環仍走驗證',()=>{
  const G={},c={G,Object,ArrayBuffer,Uint8Array,DataView,TextEncoder,TextDecoder};vm.createContext(c);for(const f of ['js/net/codec.js','js/net/protocol.js'])vm.runInContext(read(f),c);
  const id='a'.repeat(32),p=[0,0,0,0,100,100,0,'tackle',1,78,0,1,0,0,1,id],frame={k:'f',p,ev:[]};const packed=G.NetCodec.encode(frame);assert.ok(packed instanceof ArrayBuffer);const back=G.NetCodec.decode(packed);assert.deepEqual(JSON.parse(JSON.stringify(back)),frame);assert.ok(G.NetProtocol.message(back,false));
  assert.throws(()=>G.NetCodec.decode(packed.slice(0,-1)));assert.equal(G.NetProtocol.message({...frame,p:[...p.slice(0,15),'<script>']},false),false);assert.equal(G.NetProtocol.message({...frame,ev:[['fxr',0,0,1e9,'#fff']]},false),false);
});
