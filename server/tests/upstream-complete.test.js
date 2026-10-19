'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8'),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){let seed=71;const math=Object.create(Math);math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 const G={U:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),pickN:(a,n)=>a.slice(0,n),TYPE_COLOR:new Proxy({},{get:()=> '#fff'}),TYPE_NAME:new Proxy({},{get:()=> 'type'})},Types:{mult:()=>1,label:()=>null},Weather:{mult:()=>1,speedFor:()=>1},FX:{dmgText(){},burst(){},ring(){}},Audio:{sfx(){}},Camera:{kick(){}},Projectiles:{clearOrbs(){}}};
 const c={G,Math:math,performance:{now:()=>100000}};vm.createContext(c);for(const p of ['js/systems/stats.js','js/entities/player.js','js/data/moves.js','js/data/items.js','js/systems/levelup.js','js/ui/bonuses.js'])vm.runInContext(read(p),c);
 const p=Object.assign(Object.create(G.Player.prototype),{mon:{name:'fixture',types:['fire','psychic'],atk:2,pa:2,sa:1,df:75,sd:75},baseAtk:2,atkMul:1,baseMaxHp:100,itemHpMul:1,hp:100,cdMul:1,baseSpd:100,spdMul:1,dmgReduce:0,itemDmgReduce:0,buffs:{atk:{n:0,amount:0},patk:{n:0,amount:0},satk:{n:0,amount:0},def:{n:0,amount:0},spd:{n:0,amount:0},regen:{n:0,amount:0}},moves:[],slots:[],active:0,statsTaken:{},maxMoves:4,banned:new Set(),anim:{play(){}},item:null,x:0,y:0,bodyH:1,invuln:0});return {G,p,c};}
test('物特分類與弱項倍率跟原作一致，劍舞／詭計僅強化對應側，生命寶珠保留10%代價',()=>{
 const {G,p}=fixture();near(p.atkFor({cat:'physical'}),2);near(p.atkFor({cat:'special'}),1);p.buffs.patk={n:5,amount:.13};near(p.atkFor({cat:'physical'}),3.3);near(p.atkFor({cat:'special'}),1);p.buffs.satk={n:5,amount:.13};near(p.atkFor({cat:'special'}),1.65);
 p.equip('lifeorb');near(p.maxHp,90);near(p.atkFor({cat:'physical'}),4.29);near(p.atkFor({cat:'special'}),2.145);p.addMaxHp(20);near(p.maxHp,108);p.equip(null);near(p.maxHp,120);
 assert.equal(G.Moves.BY_ID['swords-dance'].stat,'patk');assert.equal(G.Moves.BY_ID['dragon-dance'].stat,'patk');assert.equal(G.Moves.BY_ID['nasty-plot'].stat,'satk');assert.ok(G.Moves.poolFor({types:['water']}).includes('nasty-plot'));
 for(const m of G.Moves.ALL)assert.ok(m.kind==='buff'?m.cat===null:['physical','special'].includes(m.cat));
});
test('原作防禦：80%效果上限、近戰與物特防禦另乘，傷害／顯示一致；純傷忽略',()=>{
 const {G,p}=fixture();p.mon.df=230;p.dmgReduce=.8;p.slots=[[{kind:'melee'}]];p.hurt(100,null,false,'physical');near(p.hp,88.3);near(p.effectiveReduction,.85);assert.equal(G.Bonuses.rows(p).find(r=>r.id==='def').value,'88.3%');p.invuln=0;p.hurt(20,null,true,'physical');near(p.hp,68.3);
 p.hp=100;p.invuln=0;p.mon.sd=5;p.dmgReduce=0;p.slots=[];p.hurt(10,null,false,'special');near(p.hp,87.5);assert.equal(G.Bonuses.rows(p).find(r=>r.id==='sdef').value,'-25.0%');
});
test('加權候選偏好強項，但不鎖定場次；固定種子抽樣涵蓋整個可學池',()=>{
 const {G,p}=fixture();p.banned=new Set(G.Moves.ALL.filter(m=>m.kind==='buff').map(m=>m.id));const pool=G.Moves.poolFor(p.mon).filter(id=>!p.banned.has(id)),seen=new Set();let physical=0,special=0;
 for(let i=0;i<2000;i++)for(const card of G.LevelUp.offer(p,100))if(card.type==='new'){const id=card.key.slice(4);seen.add(id);G.Moves.BY_ID[id].cat==='physical'?physical++:special++;}
 assert.equal(seen.size,pool.length);const a=pool.filter(id=>G.Moves.BY_ID[id].cat==='physical').length,b=pool.length-a;assert.ok(physical/a>special/b*1.2);
});
test('公開資料惡意型別、NaN、超長陣列均回退安全值，Unicode名稱保留，輸出仍須轉義',()=>{
 const G={DEX_BY:{1:{},25:{}}};vm.runInNewContext(read('js/core/public-data.js'),{G});const p=G.PublicData.rank('a',{t:'<img>',lv:NaN,kills:Infinity,names:['訓練家甲','<script>'],dex:[1,25,2,3,4],shiny:[true,'true',1]});assert.equal(p.t,0);assert.equal(p.lv,1);assert.equal(p.kills,0);assert.equal(p.names[0],'訓練家甲');assert.deepEqual(Array.from(p.shiny),[true,false,false,false]);assert.equal(G.PublicData.rows('x').length,0);assert.equal(G.PublicData.rows([]).length,0);assert.equal(Object.keys(G.PublicData.top(JSON.parse('{"__proto__":{"t":1}}'))).length,0);
 const prof=G.PublicData.profile({name:'玩家_日本語',title:'<svg onload=1>',best:{solo:'1',kills:1e14},favs:[null,{dex:1,shiny:true},{dex:999,shiny:true}],medals:Array(100).fill('a'.repeat(100))});assert.equal(prof.name,'玩家_日本語');assert.equal(prof.title,'<svg onload=1>');assert.equal(prof.best.solo,0);assert.equal(prof.best.kills,1e12);assert.equal(prof.favs.length,1);assert.equal(prof.medals.length,8);assert.equal(prof.medals[0].length,40);
 for(const bad of [null,undefined,[],42,'<script>'])assert.equal(G.PublicData.profile(bad).name,'');
});
test('收藏雙語名稱／編號、交叉篩選、取得／使用排序及最愛獨立於世代',()=>{
 const G={I18n:{lang:'zh-TW'},DEX:[{dex:1,name:'妙蛙種子',searchName:'Bulbasaur',gen:1,types:['grass'],rarity:1},{dex:25,name:'皮卡丘',searchName:'Pikachu',gen:1,types:['electric'],rarity:2},{dex:152,name:'菊草葉',searchName:'Chikorita',gen:2,types:['grass'],rarity:1}],DB:{isFavorite:d=>d===152}};vm.runInNewContext(read('js/ui/collection.js'),{G});const save={owned:{1:{at:10},25:{at:30},152:{at:20}},shiny:{25:{}},pused:{1:2,25:1,152:4}},f=()=>({q:'',status:'all',shiny:false,rar:new Set(),type:'',sort:'num'}),ids=(query,gen=0,fav=false)=>Array.from(G.Collection.list(save,query,gen,fav),p=>p.dex);
 assert.deepEqual(ids({...f(),q:'bulba'},2),[1]);assert.deepEqual(ids({...f(),q:'皮卡'}),[25]);assert.deepEqual(ids({...f(),q:'#152'},1),[152]);assert.deepEqual(ids({...f(),type:'grass',rar:new Set([1])}),[1,152]);assert.deepEqual(ids({...f(),sort:'new'}),[25,152,1]);assert.deepEqual(ids({...f(),sort:'used'}),[152,1,25]);assert.deepEqual(ids(f(),1,true),[152]);assert.deepEqual(ids({...f(),shiny:true}),[25]);
});
test('使用次數採原作max合併，既有最愛與儲備格式不轉換',()=>{
 const c={G:{DEX_BY:{1:{},4:{}}},console,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};vm.runInNewContext(read('js/core/db.js'),c);const d=c.G.DB;d.playAsGuest();d.toggleFavorite(1);const a=JSON.parse(JSON.stringify(d.save));a.pused={1:2};const b=JSON.parse(JSON.stringify(a));b.pused={1:5};const merged=d.merge(a,b);assert.equal(merged.pused[1],5);assert.ok(merged.favorites[1].on);assert.equal(merged.dfav,undefined);
});
test('物特攻擊封包接受兩種分類與舊格式，拒絕任意類別且其他界線保留',()=>{
 const G={};vm.runInNewContext(read('js/net/protocol.js'),{G,TextEncoder});const p=[0,0,0,0,100,100,0,'tackle',1,1,0,0,0];for(const cat of ['physical','special',null])assert.ok(G.NetProtocol.message({k:'f',p,ev:[['es',0,0,0,0,1,1,1,'normal',cat]]},false));assert.equal(G.NetProtocol.message({k:'f',p,ev:[['es',0,0,0,0,1,1,1,'normal','<script>']]},false),false);
});

test('外部boot依儲存／路徑／瀏覽器選語言，繁中與英文不互相覆蓋',()=>{
 for(const [saved,path,nav,expected] of [[null,'/en/','zh-TW','en'],[null,'/zh-TW/','en','zh-Hant'],['es','/en/','zh-TW','es']]){
 const ps=[{},{}],document={documentElement:{},querySelector:()=>null,querySelectorAll:()=>ps},window={};vm.runInNewContext(read('js/core/boot.js'),{document,window,localStorage:{getItem:()=>saved},navigator:{language:nav},location:{pathname:path}});assert.equal(document.documentElement.lang,expected);assert.equal(window.PS_PAGES,false);if(expected==='zh-Hant')assert.equal(ps[1].textContent,'載入中…');
 }
});
test('選卡預估分列物特結果，不污染原玩家buff／生命',()=>{
 const {G,p}=fixture();const atk=G.Bonuses.cardSummary({key:'stat:atk'},p);assert.match(atk,/Ataque físico: 2.00 → 2.20/);assert.match(atk,/Ataque especial: 1.00 → 1.10/);near(p.atkMul,1);near(p.hp,100);
});

test('外部啟動腳本同時出現在正式入口與Docker封裝清單',()=>{
 assert.match(read('dev.html'),/<script src="js\/core\/boot.js"><\/script>/);assert.match(read('Dockerfile'),/COPY --from=game-build \/game\/js\/core\/boot.js \/usr\/share\/nginx\/html\/js\/core\/boot.js/);
 const executable=[...read('dev.html').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attrs,body])=>!attrs.includes('src=')&&!attrs.includes('ld+json')&&body.trim());assert.equal(executable.length,0);
});

test('收藏名稱排序使用獨立語境，不沿用帳號名稱翻譯',()=>{
 assert.match(read('js/ui/menu.js'),/\['name', 'Nombre del Pokémon'\]/);
 const zh=JSON.parse(read('tools/translations/zh-TW.json'));assert.equal(zh['Pokémon name'],'名稱');assert.equal(zh['Pokémon type'],'寶可夢屬性');
});

test('登入與能力標籤按語境區分，不把會心率當效果名稱',()=>{
 const zh=JSON.parse(read('tools/translations/zh-TW.json'));assert.equal(zh.Name,'名稱');assert.equal(zh.Critical,'會心率');assert.equal(zh.Regeneration,'每秒體力回復');assert.match(read('dev.html'),/<label for="f-user">Nombre de acceso<\/label>/);assert.match(read('js/ui/menu.js'),/bar\('Ataque físico', p.pa/);
});
