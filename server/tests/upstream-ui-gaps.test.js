'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
function language(){
  function Canvas(){};for(const k of ['fillText','strokeText','measureText'])Canvas.prototype[k]=s=>s;
  const G={},c={G,Intl,CanvasRenderingContext2D:Canvas,localStorage:{getItem:()=> 'zh-TW'},navigator:{language:'zh-TW'},location:{pathname:'/zh-TW/'},document:{documentElement:{}},window:{confirm:s=>s,alert:s=>s}};
  for(const f of ['js/core/i18n.js','js/data/lang-zh-TW.js'])vm.runInNewContext(read(f),c);
  return {G,c};
}
test('多人等待名單使用繁中連接詞，保留碰巧與翻譯字典同名的玩家',()=>{
  const {G,c}=language(),wait={textContent:'',setAttribute(){}};
  Object.assign(G,{UI:{$:()=>wait},Social:{me:{name:'我自己'}}});vm.runInNewContext(read('js/ui/run-ui.js'),c);
  G.RunUI.setWaiting(['Fuego','我自己']);assert.match(wait.textContent,/Fuego/);assert.match(wait.textContent,/你/);assert.doesNotMatch(wait.textContent,/ y |tú/);
  G.RunUI.setWaiting(['Fuego','Alice']);assert.match(wait.textContent,/Fuego/);assert.match(wait.textContent,/Alice/);assert.doesNotMatch(wait.textContent,/ y /);
  G.RunUI.setWaiting([]);assert.equal(wait.textContent,'');
});
test('目前每項成就名稱、說明及稱號都能以繁中顯示',()=>{
  const {G,c}=language();G.SPRITE_META=new Proxy({},{get:()=>true});
  for(const f of ['js/data/pokedex.js','js/data/moves.js','js/data/items.js','js/core/localized-data.js','js/data/achievements.js'])vm.runInNewContext(read(f),c);
  for(const a of G.AchDefs.LIST)for(const key of ['name','desc','title'])if(a[key])assert.match(G.T(a[key]),/\p{Script=Han}/u,`${a.id}.${key}: ${G.T(a[key])}`);
});
test('稱號顯示翻譯但選項保留原值，舊譯文可唯一對回已解鎖稱號',()=>{
  const source=read('js/ui/goals-ui.js'),body=source.slice(source.indexOf('    function profile(box)'),source.indexOf('    function pickFav(i)'));
  const selections=[],nodes=()=>({style:{},appendChild(){},insertAdjacentHTML(){}}),G={DB:{online:false,save:{profile:{favs:[],title:'收藏家'}}},Progress:{titles:()=>['Coleccionista']},T:t=>t==='Coleccionista'?'收藏家':t};let saved=0;
  const document={createElement:tag=>{const n=nodes();if(tag==='select')selections.push(n);return n;}};
  vm.runInNewContext(body+'\nprofile(box);',{G,document,box:nodes(),save:()=>saved++,esc:s=>s});
  assert.equal(saved,1);assert.equal(G.DB.save.profile.title,'Coleccionista');assert.match(selections[0].innerHTML,/<option value="Coleccionista" selected>/);
  selections[0].value='';selections[0].onchange();assert.equal(G.DB.save.profile.title,'');
});
test('重用同一動畫 Canvas 只保留新動畫',()=>{
  let updates=0;const G={Sprites:{PX:1,animMeta:()=>null,Animator:class{loop(){}update(){updates++;}draw(){}}}},c={G,window:{},document:{}};
  vm.runInNewContext(read('js/ui/ui.js'),c);
  const ctx=new Proxy({},{get:()=>()=>{}}),cv={getContext:()=>ctx,isConnected:true,offsetParent:{},width:90,height:80};G.UI.sprite(cv,1);G.UI.sprite(cv,2);
  G.UI.tick(.1);assert.equal(updates,1);
});
test('HUD 物特增益可讀且左上資訊與天氣避開非零安全區',()=>{
  const {G,c}=language(),texts=[];
  const ctx=new Proxy({fillText:(text,x,y)=>texts.push({text,x,y}),measureText:()=>({width:100}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
  Object.assign(G,{Touch:{clearButtons(){},active:false,safeArea:()=>({left:30,right:40,top:20,bottom:0})},Settings:{get:k=>k==='healthPosition'?'hud':false},DB:{survivor:()=>false},U:{clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),mmss:()=> '00:30'},World:{biomeName:()=> 'test'},Weather:{current:{name:'TEST',left:10}},Icons:{draw(){}},EnemyMgr:{all:()=>[],shinies:()=>[]},Camera:{},Coop:{active:false},Rift:{},Events:{drawHud(){}},Spawner:{banner:()=>null}});
  c.performance={now:()=>0};vm.runInNewContext(read('js/ui/hud.js'),c);
  const pl={mon:{name:'Pikachu'},kills:0,coins:0,xp:0,xpNext:10,hp:100,maxHp:100,level:1,buffs:{patk:{n:1},satk:{n:2}},slots:[],active:0};
  G.HUD.draw(ctx,800,600,pl,{time:30});assert.deepEqual(texts.find(t=>t.text==='Pikachu'),{text:'Pikachu',x:46,y:50});
  assert.ok(texts.some(t=>t.text==='物理攻擊 ×1'));assert.ok(texts.some(t=>t.text==='特殊攻擊 ×2'));assert.ok(texts.every(t=>!String(t.text).includes('undefined')));
  assert.equal(texts.find(t=>t.text==='TEST · 10s').y,51);
});
test('手動準星依滑鼠／搖桿繪製，停用及過場不繪製並還原游標',()=>{
  const src=read('js/game.js'),fn=src.slice(src.indexOf('  function drawAimMark()'),src.indexOf('  function render()'));
  const arcs=[],c={state:'playing',pl:{manualAim:true,x:100,y:100,aim:0},cv:{style:{}},ctx:new Proxy({arc:(x,y)=>arcs.push([x,y])},{get:(o,k)=>k in o?o[k]:()=>{}}),G:{Judgment:{cinematic:false},Pad:{aim:()=>false},Input:{mouse:()=>({x:20,y:30})},Camera:{scale:1,left:()=>0,top:()=>0},LIFT:10}};
  vm.createContext(c);vm.runInContext(fn,c);vm.runInContext('drawAimMark()',c);assert.deepEqual(arcs[0],[20,30]);assert.equal(c.cv.style.cursor,'crosshair');
  c.G.Pad.aim=()=>true;arcs.length=0;vm.runInContext('drawAimMark()',c);assert.deepEqual(arcs[0],[190,95]);assert.equal(c.cv.style.cursor,'');
  c.state='ui';arcs.length=0;vm.runInContext('drawAimMark()',c);assert.equal(arcs.length,0);
  c.state='playing';c.G.Judgment.cinematic=true;vm.runInContext('drawAimMark()',c);assert.equal(arcs.length,0);
  assert.match(src,/G\.Touch\.draw\(ctx\);\s+drawAimMark\(\);/);
});
test('個人展示寶可夢可搜尋中文及英文，不存在的名稱不回傳結果',()=>{
  const src=read('js/ui/goals-ui.js'),start=src.indexOf('      const fill = q =>'),end=src.indexOf("      $('fav-q').oninput",start);
  const grid={children:[],set innerHTML(v){this.children=[];},appendChild(n){this.children.push(n);}},G={DEX_BY:{25:{name:'皮卡丘',searchName:'Pikachu'}},DB:{ownsShiny:()=>false},UI:{spriteCanvas:()=>({})},Icons:{html:()=>''}},s={owned:{25:{}}};
  const c={G,s,$:()=>grid,document:{createElement:()=>({appendChild(){},insertAdjacentHTML(){}})},esc:t=>t};vm.createContext(c);vm.runInContext(src.slice(start,end)+'globalThis.fill=fill;',c);
  c.fill('皮卡');assert.equal(grid.children.length,1);c.fill('pikachu');assert.equal(grid.children.length,1);c.fill('不存在');assert.equal(grid.children.length,0);
});
