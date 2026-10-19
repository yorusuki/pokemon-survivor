 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function db(){const c={G:{DEX_BY:{1:{},4:{}}},console,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};vm.createContext(c);vm.runInContext(read('js/core/db.js'),c);c.G.DB.playAsGuest();return c.G.DB;}
test('招式儲備未購買不能切換，預設開啟、分寶可夢保存並合併最新選擇',()=>{
 const d=db();assert.equal(d.reserveEnabled(1),true);assert.equal(d.setReserveEnabled(1,false),false);
 d.save.pupg={1:{moves:1},4:{moves:1}};assert.equal(d.setReserveEnabled(1,false),true);assert.equal(d.reserveEnabled(1),false);assert.equal(d.reserveEnabled(4),true);
 const old=JSON.parse(JSON.stringify(d.save));d.setReserveEnabled(1,true);const newer=JSON.parse(JSON.stringify(d.save));assert.equal(d.merge(old,newer).moveReserve[1].enabled,true);assert.equal(d.merge(newer,old).moveReserve[1].enabled,true);
 assert.equal(d.save.pupg[1].moves,1);assert.equal(d.setReserveEnabled(0,false),false);assert.equal(d.setReserveEnabled(1,'yes'),false);
});
function itemFlow(){
 const open=new Set(),events=[],equipped=[],choices=[],holds=[];
 const c={state:'playing',pl:{item:null,equip(id){this.item=id;equipped.push(id);}},holdBy:[],G:{Items:{BY:{lifeorb:{name:'orb'},focussash:{name:'sash'}}},UI:{isOpen:id=>open.has(id)},Coop:{active:true,holdStart(){holds.push('start');},holdEnd(){holds.push('end');}},RunUI:{showItemChoice(cur,next,take){open.add('scr-item');choices.push({cur,next,take});}},Spawner:{say(){}},Progress:{event(...e){events.push(e);}}}};
 vm.createContext(c);const s=read('js/game.js');vm.runInContext(s.slice(s.indexOf('  let openItem = null;'),s.indexOf('  /** @param who'))+';this.offer=offerItem;this.after=afterLevelUp;',c);
 const choose=id=>{open.delete('scr-item');choices.at(-1).take(id);};return {c,open,events,equipped,choices,holds,choose};
}
test('首件道具先詢問，拒絕不裝備並恢復合作；接受才套用',()=>{
 const f=itemFlow();f.c.offer('lifeorb');assert.equal(f.c.state,'choice');assert.deepEqual(f.equipped,[]);assert.equal(f.choices[0].cur,null);f.choose(null);assert.deepEqual(f.equipped,[]);assert.deepEqual(f.events,[]);assert.equal(f.c.state,'playing');assert.deepEqual(f.holds,['start','end']);
 f.c.offer('lifeorb');f.choose('lifeorb');assert.deepEqual(f.equipped,['lifeorb']);assert.equal(f.events.length,1);
});
test('道具選擇排隊且不覆蓋，升級後恢復詢問',()=>{
 const f=itemFlow();f.c.offer('lifeorb');f.c.offer('focussash');assert.equal(f.choices.length,1);f.choose(null);assert.equal(f.choices.length,2);assert.equal(f.choices[1].next,'focussash');f.choose('focussash');assert.equal(f.c.pl.item,'focussash');assert.equal(f.c.state,'playing');
 const g=itemFlow();g.c.state='levelup';g.c.offer('lifeorb');assert.equal(g.choices.length,0);g.c.state='playing';g.c.after();assert.equal(g.choices[0].next,'lifeorb');
});
test('沒有現有道具的選擇介面可選不裝備，已有道具仍可保留',()=>{
 let now=0;const nodes={},shown=[];const element=()=>({children:[],className:'',innerHTML:'',classList:{add(){},remove(){}},appendChild(e){this.children.push(e);}});nodes['item-cards']=element();
 const c={performance:{now:()=>now},setTimeout(){},G:{T:s=>s,UI:{$:id=>nodes[id],show:id=>shown.push(id),hide(){}},Items:{BY:{lifeorb:{name:'orb',desc:'risk'},focussash:{name:'sash',desc:'protect'}}},Icons:{html:()=>''}},document:{createElement:element}};
 vm.createContext(c);vm.runInContext(read('js/ui/run-ui.js'),c);let selected='unset';c.G.RunUI.showItemChoice(null,'lifeorb',id=>selected=id);assert.match(nodes['item-cards'].children[0].innerHTML,/No equipar/);nodes['item-cards'].children[0].onclick();assert.equal(selected,'unset');now+=600;nodes['item-cards'].children[0].onclick();assert.equal(selected,null);
 nodes['item-cards'].children=[];c.G.RunUI.showItemChoice('focussash','lifeorb',id=>selected=id);assert.match(nodes['item-cards'].children[0].innerHTML,/sash/);now+=600;nodes['item-cards'].children[1].onclick();assert.equal(selected,'lifeorb');
});

test('實際開場招式區塊尊重購買與停用，排除 buff 與被禁止招式',()=>{
 const source=read('js/game.js'),start=source.indexOf('    // Mejora "Repertorio"'),end=source.indexOf('    if (coop)',start),block=source.slice(start,end);
 for(const [bought,enabled,expected] of [[1,true,1],[2,false,1],[2,true,2]]){
  const learned=['starter'];const c={perks:{startMoves:bought},mon:{dex:1},pl:{hasMove:id=>learned.includes(id),banned:new Set(['banned']),addMove:id=>learned.push(id),setActive(){}},G:{DB:{reserveEnabled:()=>enabled},Moves:{poolFor:()=>['starter','buff','banned','attack'],BY_ID:{starter:{kind:'melee'},buff:{kind:'buff'},banned:{kind:'melee'},attack:{kind:'melee'}}},U:{pick:list=>list[0]}}};vm.createContext(c);vm.runInContext(block,c);assert.equal(learned.length,expected);if(expected===2)assert.equal(learned[1],'attack');
 }
});
