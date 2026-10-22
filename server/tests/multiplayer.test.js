'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture() {
 const timers=new Map(),pcs=[],signals=[],logs=[],callbacks={};let tick=0;
 class PC {
  constructor(){this.connectionState='new';this.added=[];pcs.push(this);}
  createDataChannel(){return this.dc={readyState:'open',send(){},close(){}};}
  async createOffer(){return {type:'offer',sdp:'fixture'};}
  async setLocalDescription(s){this.localDescription={...s,toJSON:()=>s};}
  async setRemoteDescription(s){this.remoteDescription=s;}
  async addIceCandidate(c){this.added.push(c);}
  close(){this.connectionState='closed';}
 }
 const host='a'.repeat(32),guest='b'.repeat(32);
 const ref={on:(event,fn)=>callbacks.signal=fn,off(){},push:async data=>signals.push(JSON.parse(data))};
 const G={Backend:{iceServers:async()=>[],api:async()=>({ok:true})},DB:{fb:{uid:host,rtdb:{ref:()=>ref}}},NetProtocol:{parse:()=>null,message:()=>true}};
 const ctx={G,Object,ArrayBuffer,Uint8Array,DataView,TextEncoder,TextDecoder,RTCPeerConnection:PC,console:{info:(...x)=>logs.push(x),warn(){},error(){}},setTimeout:(fn,ms)=>{timers.set(++tick,{fn,ms});return tick;},clearTimeout:id=>timers.delete(id),performance:{now:()=>0}};
 vm.createContext(ctx);for(const f of ['js/net/codec.js','js/net/protocol.js','js/net/net.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../'+f),'utf8'),ctx);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 const incoming=sig=>callbacks.signal({val:()=>JSON.stringify({f:guest,sig}),ref:{remove:async()=>{}}});
 return {G,host,guest,pcs,timers,incoming,flush,logs};
}
test('三位訪客同時加入：各一條連線、30 秒期限、短暫斷線恢復與關閉清理',async()=>{
 const f=fixture(),n=f.G.Net,guests=['b','c','d'].map(x=>x.repeat(32));
 n.open('room',true,f.host);n.syncMembers([f.host,...guests]);n.syncMembers([f.host,...guests]);await f.flush();
 assert.equal(f.pcs.length,3);assert.equal([...f.timers.values()].filter(x=>x.ms===30000).length,3);
 const p=f.pcs[0];p.dc.onopen();p.connectionState='disconnected';p.onconnectionstatechange();
 assert.ok([...f.timers.values()].some(x=>x.ms===15000));assert.equal(n.mode(guests[0]),'direct');
 p.connectionState='connected';p.onconnectionstatechange();assert.equal(n.mode(guests[0]),'direct');
 assert.ok(n.diagnostics().some(x=>x.event==='recovered'));
 p.connectionState='failed';p.onconnectionstatechange();assert.equal(n.mode(guests[0]),'failed');
 n.close();assert.equal(f.timers.size,0);
});
test('房主在 answer 前收到 ICE candidate：answer 後補上，不遺失候選；關房後不建立連線',async()=>{
 const f=fixture(),n=f.G.Net;n.open('room',true,f.host);n.syncMembers([f.host,f.guest]);await f.flush();
 f.incoming({c:{candidate:'fixture'}});f.incoming({sdp:{type:'answer',sdp:'fixture'}});await f.flush();
 assert.equal(f.pcs[0].added.length,1);
 f.incoming({sdp:{type:'answer',sdp:'late'}});n.close();await f.flush();assert.equal(n.peers().length,0);
});
test('協商超時會記錄原因，房主 15 秒後重試',async()=>{
 const f=fixture(),n=f.G.Net;n.open('room',true,f.host);n.syncMembers([f.host,f.guest]);await f.flush();
 [...f.timers.values()].find(x=>x.ms===30000).fn();assert.equal(n.mode(f.guest),'failed');
 assert.ok(n.diagnostics().some(x=>x.event==='failed'&&x.reason==='timeout'));
 [...f.timers.values()].find(x=>x.ms===15000).fn();await f.flush();assert.equal(f.pcs.length,2);n.close();
});


test('選用候選為 relay 時診斷標為 TURN，不輸出候選位址',async()=>{
 const f=fixture(),n=f.G.Net;n.open('room',true,f.host);n.syncMembers([f.host,f.guest]);await f.flush();
 f.pcs[0].getStats=async()=>new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{localCandidateId:'local',remoteCandidateId:'remote'}],['local',{candidateType:'relay',address:'do-not-log'}],['remote',{candidateType:'host'}]]);
 f.pcs[0].dc.onopen();await f.flush();assert.equal(n.route(f.guest),'turn');assert.ok(!JSON.stringify(n.diagnostics()).includes('do-not-log'));n.close();
});

test('每條通道協商二進位後才編碼，仍驗證內容並維持JSON後備',async()=>{
 const f=fixture(),n=f.G.Net,received=[],sent=[];n.on((u,m)=>received.push(m));n.open('room',true,f.host);n.syncMembers([f.host,f.guest]);await f.flush();const dc=f.pcs[0].dc;dc.send=x=>sent.push(x);dc.onopen();
 const p=[0,0,0,0,100,100,0,'tackle',1,78,0,1,0,0,1,''],frame={k:'f',p,ev:[]};
 n.send(f.guest,frame);assert.equal(typeof sent.at(-1),'string');
 dc.onmessage({data:JSON.stringify({k:'net-cap',binary:1})});n.send(f.guest,frame);assert.ok(sent.at(-1) instanceof ArrayBuffer);assert.ok(n.stats.binarySent>0);
 dc.onmessage({data:f.G.NetCodec.encode(frame)});assert.equal(received.length,1);assert.ok(n.stats.binaryRecv>0);
 dc.onmessage({data:JSON.stringify({k:'net-cap',binary:99})});n.send(f.guest,frame);assert.equal(typeof sent.at(-1),'string');n.close();
});
