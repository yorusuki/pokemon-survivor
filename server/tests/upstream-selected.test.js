'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function el(){const classes=new Set();return {children:[],dataset:{},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},innerHTML:'',textContent:'',appendChild(e){this.children.push(e);},get firstElementChild(){return this.children[0];},get lastElementChild(){return this.children.at(-1);},querySelector(){return el();},querySelectorAll(){return this.children;}};}
function runUI(){let now=0;const nodes={};const $=id=>nodes[id]||(nodes[id]=el());const summary=$('level-bonus-summary');summary.appendChild(el());summary.appendChild(el());
 const G={T:s=>s,UI:{$,show(){},hide(){},soundControls(){}},Icons:{html:()=>''},Bonuses:{rows:()=>[],cardSummary:()=>''},Game:{player:{rerolls:0,rerollBonus:1},st:{time:30}},I18n:{lang:'zh-TW'},U:{escapeHTML:esc},Items:{BY:{orb:{name:'orb',desc:'risk'}}},LevelUp:{STATS:[],offer:()=>[]},Audio:{sfx(){}}};
 const c={G,performance:{now:()=>now},setTimeout(){},document:{createElement:el}};vm.runInNewContext(read('js/ui/run-ui.js'),c);return {G,nodes,$,setTime:n=>now=n};}
test('升級、重抽、連結與道具都阻擋初始 600ms，允許時間邊界且同次選擇不重複回呼',()=>{
 const f=runUI();let picks=0;const card={title:'test',desc:'test',color:'#fff',type:'new',icon:'a'};
 f.G.RunUI.showLevelUp(2,[card],()=>picks++);f.G.RunUI.pick(0);assert.equal(picks,0);f.setTime(599);f.G.RunUI.pick(0);assert.equal(picks,0);f.setTime(600);f.G.RunUI.pick(0);f.G.RunUI.pick(0);assert.equal(picks,1);
 f.G.RunUI.showLevelUp(3,[card],()=>picks++);f.G.RunUI.reroll();assert.equal(f.G.Game.player.rerolls,0);f.setTime(1200);f.G.RunUI.reroll();assert.equal(f.G.Game.player.rerolls,1);
 f.G.RunUI.showItemChoice(null,'orb',()=>picks++);f.$('item-cards').children.at(-1).onclick();assert.equal(picks,1);f.setTime(1800);const choose=f.$('item-cards').children.at(-1).onclick;choose();choose();assert.equal(picks,2);
 const a={name:'a',type:'normal',id:'a',lvl:1},b={...a,name:'b',id:'b'};f.G.U.TYPE_COLOR={normal:'#fff'};f.G.RunUI.showBond({mode:'pair',loose:[a,b]},()=>picks++);f.G.RunUI.pickBond(0);f.setTime(2400);f.G.RunUI.pickBond(0);f.G.RunUI.pickBond(0);assert.equal(picks,2);f.setTime(3000);f.G.RunUI.pickBond(0);assert.equal(picks,3);
});
test('暫停摘要只顯示現行能力、顯示物特，轉義動態名稱；DPS 按遊戲時間計',()=>{
 const {G}=runUI();G.Stats={taken:()=>1,NAME:{physical:'physical',special:'special'}};G.Game.player={mon:{types:[]},atkFor:()=>1.3,moves:[{name:'<img>',id:'x',kind:'melee',lvl:2,since:10,dealt:100}],hp:90,maxHp:100,atk:1.3,spd:100,effectiveReduction:.9,critChance:0,cdMul:1,regen:0,statsTaken:{}};
 const html=G.RunUI.pauseSummary();assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<img>/);assert.match(html,/5\/s/);assert.match(html,/90%/);assert.doesNotMatch(html,/At\. Esp\.|Def\. Esp\.|Crítico/);assert.equal(G.RunUI.pauseSummary(),html);
});
function padFixture(){let sample=null;const keys=[],listeners={};const G={Settings:{get:()=>true},Game:{state:'playing'},Input:{virtual:k=>keys.push(k)}};
 const c={G,navigator:{getGamepads:()=>sample?[sample]:[]},document:{hidden:false,querySelectorAll:()=>[]},getComputedStyle:()=>({}),addEventListener:(k,fn)=>listeners[k]=fn,performance:{now:()=>100},console,setTimeout(){}};vm.runInNewContext(read('js/core/gamepad.js'),c);
 const buttons=Array.from({length:16},()=>({pressed:false,value:0}));sample={connected:true,id:'Fixture',axes:[1,1,.8,0],buttons};return {G,c,keys,setPad:p=>sample=p,sample};}
test('手把軸正規化、按鍵僅觸發一次、斷線及隱藏頁面不殘留移動或瞄準',()=>{
 const f=padFixture();f.sample.buttons[5].pressed=true;f.G.Pad.poll(.016);assert.ok(Math.abs(Math.hypot(...f.G.Pad.vector())-1)<1e-9);assert.deepEqual(f.keys,['keye']);assert.ok(f.G.Pad.aim());f.G.Pad.poll(.016);assert.equal(f.keys.length,1);
 f.c.document.hidden=true;f.G.Pad.poll(.016);assert.equal(Math.hypot(...f.G.Pad.vector()),0);assert.equal(f.G.Pad.aim(),null);f.c.document.hidden=false;f.setPad(null);f.G.Pad.poll(.016);assert.equal(f.G.Pad.aim(),null);
});
test('手把禁用或瀏覽器不提供 Gamepad API 時可維持鍵盤模式',()=>{
 const f=padFixture();f.G.Settings.get=()=>false;f.G.Pad.poll(.016);assert.equal(Math.hypot(...f.G.Pad.vector()),0);f.G.Settings.get=()=>true;delete f.c.navigator.getGamepads;f.G.Pad.poll(.016);assert.equal(f.G.Pad.name,'');
});
test('輸入整合保留觸控優先權、手把次之、虛擬按鍵在 frame 後清除',()=>{
 const events={};const G={Touch:{vector:()=>[0,0]},Pad:{vector:()=>[.5,0]},U:{norm:(x,y)=>[x,y]},Camera:{left:()=>10,top:()=>20,scale:2}};
 vm.runInNewContext(read('js/core/input.js'),{G,addEventListener:(k,fn)=>events[k]=fn,performance:{now:()=>99}});
 assert.equal(G.Input.axis()[0],.5);G.Touch.vector=()=>[0,1];assert.equal(G.Input.axis()[1],1);G.Input.virtual('escape');assert.ok(G.Input.tap('escape'));G.Input.endFrame();assert.equal(G.Input.tap('escape'),false);events.mousemove({clientX:100,clientY:80});assert.equal(G.Input.mouseWorld().x,60);assert.equal(G.Input.mouseWorld().y,60);
});
test('手動瞄準預設自動；右搖桿或滑鼠啟用時選取方向目標，遠端角色不讀本機瞄準',()=>{
 const G={Settings:{get:()=>false},Input:{mouseMovedAt:100,mouseWorld:()=>({x:0,y:10})},Touch:{active:false},Pad:{aim:()=>null,aimAt:0},LIFT:0};vm.runInNewContext(read('js/entities/player.js'),{G});
 const p=Object.assign(Object.create(G.Player.prototype),{x:0,y:0});assert.equal(p.handAim(),null);G.Settings.get=()=>true;assert.equal(p.handAim(),Math.PI/2);G.Pad.aim=()=>[-1,0];assert.equal(p.handAim(),Math.PI);p.remote=true;assert.equal(p.handAim(),null);
 const right={x:20,y:0},up={x:0,y:5};assert.equal(p.enemyAlong([up,right],0),right);assert.equal(p.enemyAlong([{x:600,y:0}],0),null);
});
test('大型寶可夢顯示縮小且碰撞半徑不超過18，普通尺寸維持比例',()=>{
 const G={SPR_META:{},U:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}};
 // Use real generated metadata; no network or source stubs for scale calculations.
 vm.runInNewContext(read('js/data/sprites-meta.js')+'\n'+read('js/core/sprites.js'),{G,Image:class{},document:{createElement:()=>({getContext:()=>({})})}});
 let found=false;for(const dex of [25,95,130,321,890]){const scale=G.Sprites.playerScale(dex);assert.ok(scale>0&&scale<=1);assert.ok(G.Sprites.playerRadius(dex)<=18);if(scale<1)found=true;}assert.ok(found);
});
test('舊榜缺少或部分 shiny 陣列按一般外觀補齊，既有異色與 all2 榜名保留',async()=>{
 let top={old:{t:30,uids:['a'],names:['old'],dex:[1,25],lv:1,kills:1},mixed:{t:20,uids:['b'],names:['mixed'],dex:[1,25],shiny:[true],lv:1,kills:1}};
 const G={Backend:{cloud:()=>({uid:'a',fs:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({top})})})})}})},Social:{friends:[]},DB:{save:{},user:'a'}};
 G.DB.online=true;G.DB.fb=G.Backend.cloud();
 vm.runInNewContext(read('js/core/public-data.js')+'\n'+read('js/net/ranking.js'),{G,localStorage:{getItem:()=>null,setItem(){}},console});const rows=await G.Ranking.top('s','a');assert.deepEqual(Array.from(rows[0].shiny),[false,false]);assert.deepEqual(Array.from(rows[1].shiny),[true,false]);assert.match(G.Ranking.board('s','a'),/all2/);assert.doesNotMatch(G.Ranking.board('s','a'),/all3/);
});
test('手動方向招式無目標可施放，連鎖仍等待目標，近戰與投射物傷害回填正確招式',()=>{
 const shots=[],foe={id:1,x:10,y:0,r:10,bodyH:1,types:['normal'],dead:false,touchCd:1,hurt(d){this.received=(this.received||0)+d;}};
 const G={U:{TYPE_COLOR:{normal:'#fff'},dist:(x,y,a,b)=>Math.hypot(x-a,y-b),dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,rand:()=>0},LIFT:0,FX:new Proxy({withAttack:fn=>fn()},{get:(o,k)=>o[k]||(()=>{})}),VFX:{forMove:()=>({})},World:{propsInCircle:()=>[],projectileBlock:()=>null},EnemyMgr:{queryCircle:()=>[foe]},Projectiles:{all:()=>shots,spawn:p=>shots.push({...p,friendly:true})},Types:{mult:()=>1,label:()=>null},Weather:{mult:()=>1},Coop:{active:false}};
 G.Stats={taken:()=>1};vm.runInNewContext(read('js/systems/combat.js'),{G,performance:{now:()=>10}});
 let casts=0;const m={kind:'melee',type:'normal',cd:1,t:0,dmg:10,radius:30,arc:6.2832};const p={x:0,y:0,r:1,aim:0,atk:2,atkFor:()=>2,cdMul:1,dmgDealt:0,dead:false,activeGroup:()=>[m],cast:()=>casts++,onDealt(){}};
 G.Combat.tick(.1,p,0);assert.equal(casts,0);p.manualAim=true;G.Combat.tick(.1,p,0);assert.equal(casts,1);assert.equal(m.dealt,20);
 const projectile={...m,kind:'projectile',t:0,count:1,speed:100,size:4,life:1,dealt:0};p.activeGroup=()=>[projectile];G.Combat.tick(.1,p,1);assert.equal(shots[0].src,projectile);G.Combat.resolve(.1,p,1);assert.equal(projectile.dealt,20);assert.equal(m.dealt,20);
 const chain={...m,kind:'chain',t:0};p.activeGroup=()=>[chain];G.Combat.tick(.1,p,2);assert.equal(casts,2);
});
test('手把選單 A 可導航並啟動現有按鈕；B 使用關閉按鈕返回',()=>{
 const f=padFixture();f.sample.axes=[0,0,0,0];let clicks=0,closed=0;const main=el(),close=el();
 Object.assign(main,{id:'play',isConnected:true,disabled:false,textContent:'Play',matches:sel=>sel.includes('button')||sel.includes('.play'),getBoundingClientRect:()=>({left:10,top:10,width:100,height:40,right:110,bottom:50}),contains:x=>x===main,scrollIntoView(){},click:()=>clicks++});
 Object.assign(close,{id:'test-close',isConnected:true,disabled:false,textContent:'關閉',matches:sel=>sel.includes('button'),getBoundingClientRect:()=>({left:150,top:10,width:40,height:40,right:190,bottom:50}),contains:x=>x===close,scrollIntoView(){},hasAttribute:()=>false,click:()=>closed++});main.hasAttribute=()=>false;
 const screen={classList:{contains:()=>true},querySelectorAll:()=>[main,close]};f.c.document.querySelectorAll=()=>[screen];f.c.document.getElementById=()=>null;f.c.document.elementFromPoint=()=>null;f.c.innerWidth=800;f.c.innerHeight=600;f.c.getComputedStyle=()=>({zIndex:'20',cursor:'pointer'});f.G.Game.state='ui';
 const tap=i=>{f.sample.buttons[i].pressed=true;f.G.Pad.poll(.016);f.sample.buttons[i].pressed=false;f.G.Pad.poll(.016);};tap(0);assert.equal(clicks,0);tap(0);assert.equal(clicks,1);tap(1);assert.equal(closed,1);
});
