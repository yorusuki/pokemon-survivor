'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function scope(G={}){return {G,console,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},matchMedia:()=>({matches:false}),document:{addEventListener(){},documentElement:{dataset:{}}},addEventListener(){},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};}
function load(file,c){vm.createContext(c);vm.runInContext(read(file),c);return c.G;}
function db(){const G=load('js/core/db.js',scope({DEX_BY:Object.fromEntries(Array.from({length:1025},(_,i)=>[i+1,{}]))}));G.DB.playAsGuest();return G.DB;}
test('收藏最愛上限 100，取消可釋放名額且不影響公開三隻最愛',()=>{
 const d=db();d.save.profile.favs=[1,2,3];for(let i=1;i<=100;i++)assert.equal(d.toggleFavorite(i).ok,true);
 assert.equal(d.favoriteCount(),100);assert.equal(d.toggleFavorite(101).ok,false);assert.equal(d.toggleFavorite(1).on,false);assert.equal(d.toggleFavorite(101).ok,true);
 assert.equal(d.isFavorite(1),false);assert.deepEqual(Array.from(d.save.profile.favs),[1,2,3]);assert.equal(d.toggleFavorite(0).ok,false);
});
test('取消最愛的標記不被舊存檔復活，跨裝置超額合併固定保留 100',()=>{
 const d=db();d.toggleFavorite(1);const old=JSON.parse(JSON.stringify(d.save));d.toggleFavorite(1);const recent=JSON.parse(JSON.stringify(d.save));
 assert.equal(d.merge(old,recent).favorites[1].on,false);assert.equal(d.merge(recent,old).favorites[1].on,false);
 const a=JSON.parse(JSON.stringify(old)),b=JSON.parse(JSON.stringify(old));a.favorites={};b.favorites={};
 for(let i=1;i<=100;i++)a.favorites[i]={on:true,at:i};for(let i=101;i<=200;i++)b.favorites[i]={on:true,at:i};
 const x=d.merge(a,b),y=d.merge(b,a);assert.equal(Object.values(x.favorites).filter(e=>e.on).length,100);assert.deepEqual(x.favorites,y.favorites);assert.equal(x.favorites[200].on,true);
});
test('Cubic 選項套用 Canvas 繪字與測量，返回平滑後保留原字型',()=>{
 const calls=[];function Canvas(){};for(const method of ['fillText','strokeText','measureText'])Canvas.prototype[method]=function(){calls.push(this.font);return {width:10};};
 const c=scope();c.CanvasRenderingContext2D=Canvas;const G=load('js/core/settings.js',c);G.Settings.set('fontStyle','pixel');assert.equal(c.document.documentElement.dataset.font,'pixel');
 for(const font of ['700 11px system-ui','10px sans-serif'])for(const method of ['fillText','strokeText','measureText']){const canvas=new Canvas();canvas.font=font;canvas[method]('test');assert.equal(canvas.font,font);assert.match(calls.at(-1),/Cubic 11/);}
 G.Settings.set('fontStyle','smooth');const canvas=new Canvas();canvas.font='700 11px system-ui';canvas.fillText('test');assert.equal(calls.at(-1),'700 11px system-ui');
 G.Settings.set('fontStyle','invalid');assert.equal(G.Settings.get('fontStyle'),'smooth');
});
test('角落與選卡共用實際累計加成，冷卻、乘法攻擊及近戰減傷正確',()=>{
 const G=load('js/ui/bonuses.js',scope());const pl={mon:{hp:100},maxHp:120,hp:60,atk:1.65,baseAtk:1,spd:110,baseSpd:100,cdMul:0.8,reduction:0.5,regen:1.2,critChance:0.3,xpMul:1.4,coinMul:1.5,magnet:156,rerollBonus:2,rerolls:1,banned:new Set([1]),activeGroup:()=>[{kind:'melee'}],statsTaken:{atk:2},moves:[]};
 const rows=G.Bonuses.rows(pl);assert.equal(rows.find(r=>r.id==='atk').value,'1.65');assert.equal(rows.find(r=>r.id==='cd').value,'80.0%');assert.equal(rows.find(r=>r.id==='def').value,'62.5%');
 G.LevelUp={STATS:[{id:'atk',apply:p=>p.atk*=1.1},{id:'heal',apply:p=>p.heal(p.maxHp*.45)}]};
 assert.match(G.Bonuses.cardSummary({key:'stat:atk'},pl),/1.65 → 1.81|1.65 → 1.82/);assert.match(G.Bonuses.cardSummary({key:'stat:heal'},pl),/60 → 114/);assert.equal(pl.atk,1.65);assert.equal(pl.hp,60);assert.ok(G.Bonuses.summary(pl).includes('62.5%'));
});

test('沒有取得的加成與空道具不顯示，預設重抽不佔面板',()=>{
 const G=load('js/ui/bonuses.js',scope());const pl={mon:{hp:100},maxHp:100,atk:1,baseAtk:1,spd:100,baseSpd:100,cdMul:1,reduction:0,regen:0,critChance:0,xpMul:1,coinMul:1,magnet:78,activeGroup:()=>[]};
 assert.equal(G.Bonuses.rows(pl).length,0);pl.atk=1.2;assert.deepEqual(Array.from(G.Bonuses.rows(pl),r=>r.id),['atk']);
});

test('實際能力卡預估保留 Player getter、減傷上限且不修改本人',()=>{
 const c=scope({Weather:{speedFor:()=>1},World:{liquidEffect:()=>({})}});const G=load('js/entities/player.js',c);vm.runInContext(read('js/systems/levelup.js'),c);vm.runInContext(read('js/ui/bonuses.js'),c);
 const p=Object.assign(Object.create(G.Player.prototype),{mon:{hp:100,types:['grass']},maxHp:120,hp:60,baseAtk:2,atkMul:1.5,baseSpd:100,spdMul:1,cdMul:.8,dmgReduce:.69,regenFlat:1,magnet:78,xpMul:1,buffs:{atk:{n:0,amount:0},spd:{n:0,amount:0},def:{n:0,amount:0},regen:{n:0,amount:0}},activeGroup:()=>[],statsTaken:{}});
 assert.match(G.Bonuses.cardSummary({key:'stat:atk'},p),/3.00 → 3.30/);
 assert.match(G.Bonuses.cardSummary({key:'stat:hp'},p),/120 → 140/);
 assert.match(G.Bonuses.cardSummary({key:'stat:def'},p),/69.0% → 70.0%/);
 assert.match(G.Bonuses.cardSummary({key:'stat:cd'},p),/80.0% → 73.6%/);
 assert.match(G.Bonuses.cardSummary({key:'stat:heal'},p),/60 → 114/);
 assert.equal(p.atk,3);assert.equal(p.hp,60);assert.equal(p.maxHp,120);assert.equal(p.dmgReduce,.69);assert.equal(Object.keys(p.statsTaken).length,0);
});
