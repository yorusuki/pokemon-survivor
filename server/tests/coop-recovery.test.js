'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
function coop(host){
 const h='a'.repeat(32),g='b'.repeat(32),timers=new Map(),states=new Map(),sent=[];let id=0,onPeer,onMessage,lost=0,removed=0;
 const G={Net:{uid:host?h:g,onPeer:f=>onPeer=f,on:f=>onMessage=f,mode:u=>states.get(u)||'failed',slow:()=>false,send:(u,m)=>sent.push(m)},DEX_BY:{1:{dex:1}},baseStartOf:()=> 'tackle',Sprites:{preload(){}},Player:class{constructor(){this.hp=this.maxHp=100;}},Spawner:{say(){}},Projectiles:{clearOrbs(){}},Social:{dropMember(){removed++;}},U:{dist2:(a,b,x,y)=>(a-x)**2+(b-y)**2},EnemyMgr:{all:()=>[{id:1,x:0,y:0,hp:10,anim:{cur:'Idle',dir:0}},{id:2,x:5000,y:0,hp:10,anim:{cur:'Idle',dir:0}}]},Judgment:{netState:()=>null},NetProtocol:{message:()=>true}};
 const c={G,document:{addEventListener(){}},performance:{now:()=>1},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:n=>timers.delete(n)};vm.runInNewContext(read('js/net/coop.js'),c);
 const pl={x:0,y:0,hp:100,maxHp:100,activeMove:()=>null,activeGroup:()=>[]},api={lost(){lost++;},team:()=>({time:1,level:1,xp:0,xpNext:10,kills:0,bosses:0,coins:0,t1:0,t10:0})};
 G.Coop.begin({host:h,members:[{uid:h,name:'Host',dex:1},{uid:g,name:'Guest',dex:1}]},pl,api);
 return {G,h,g,pl,timers,states,sent,onPeer,onMessage,get lost(){return lost;},get removed(){return removed;}};
}
test('客端斷線等待45秒，恢復取消計時，主動離開立即結束',()=>{
 const f=coop(false);f.onPeer(f.h,'failed');assert.equal(f.lost,0);assert.equal([...f.timers.values()][0].ms,45000);f.states.set(f.h,'direct');f.onPeer(f.h,'direct');assert.equal(f.timers.size,0);assert.equal(f.lost,0);
 f.onPeer(f.h,'closed');assert.equal(f.lost,1);
});
test('房主只在重連期限後移除席位，觀戰主端時收到主端附近敵人',()=>{
 const f=coop(true),mate=f.G.Coop.puppets()[0];mate.dead=true;mate.x=5000;mate.y=0;mate.net.wa=f.h;f.pl.x=0;f.pl.y=0;f.G.Coop.tick(1);
 assert.ok(f.sent[0].e.some(e=>e[0]===1));assert.ok(!f.sent[0].e.some(e=>e[0]===2));
 f.onPeer(f.g,'failed');assert.equal(f.removed,0);[...f.timers.values()][0].fn();assert.equal(f.removed,1);assert.equal(f.G.Coop.keeps(f.g),false);
});
test('房間輪詢暫時失敗後，相同快照也重新通知恢復，不因資料未變而漏掉',async()=>{
 const timers=[];let reads=0,changes=0,errors=0;const c={G:{},addEventListener(){},AbortSignal,console,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},fetch:async()=>{reads++;if(reads===2)throw Error('offline');return {ok:true,json:async()=>({data:{host:'x'}})};}};
 vm.runInNewContext(read('js/core/backend.js'),c);const ref=c.G.Backend.rooms.ref('rooms/abcdef/m');ref.on('value',()=>changes++,()=>errors++);
 const flush=async()=>{for(let i=0;i<14;i++)await Promise.resolve();};await flush();assert.equal(changes,1);timers.shift()();await flush();assert.equal(errors,1);timers.shift()();await flush();assert.equal(changes,2);ref.off();
});
