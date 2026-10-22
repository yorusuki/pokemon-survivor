/* 多人星狀 WebRTC：API 傳遞協商，遊戲資料走直連或 Cloudflare TURN。 */
G.Net = (() => {
  let ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const DIRECT_TIMEOUT = 30000, DISCONNECT_GRACE = 15000;
  const ALLOW_RELAY = false, RETRY_MS = 15000;
  const diagnostics = [], signalChains = new Map();
  let telemetryAt = 0, telemetryCount = 0;
  function log(event, reason = 'none', route = 'unknown', peer = '') {
    const entry = {time:new Date().toISOString(), event, reason, route, peer};
    diagnostics.push(entry); if (diagnostics.length > 100) diagnostics.shift();
    console.info('[Net]', JSON.stringify(entry));
    const now=Date.now(); if(now-telemetryAt>=60000) {telemetryAt=now;telemetryCount=0;}
    if(telemetryCount++ < 20 && G.Backend.api) G.Backend.api('network-events',{event,reason,route,peer}).catch(()=>console.warn('[Net] diagnostic_delivery_failed'));
  }

  let rtdb = null, uid = null, roomId = null, isHost = false, hostUid = null;
  let qref = null;
  const members = new Set();
  const inbound = new Map();
  const peers = new Map();         // uid -> { pc, dc, mode, timer }
  const handlers = new Set(), peerHandlers = new Set();
  const stats = { sent:0,recv:0,relaySent:0,sentBytes:0,jsonBytes:0,recvBytes:0,binarySent:0,binaryRecv:0,invalidBinary:0 };
  let epoch = 0;

  function emitPeer(u) {
    const p = peers.get(u);
    peerHandlers.forEach(fn => { try { fn(u, p ? p.mode : 'closed'); } catch { console.warn('[Net] peer_handler_failed'); } });
  }

  // ---------------- apertura ----------------

  function open(id, host, hostId) {
    if (roomId === id) return;
    close();
    const fb = G.DB.fb;
    rtdb = fb.rtdb; uid = fb.uid;
    roomId = id; isHost = host; hostUid = hostId;
    members.add(uid); members.add(hostId);
    qref = rtdb.ref('rooms/' + id + '/q/' + uid);
    qref.on('child_added', s => {
      const raw = s.val();
      s.ref.remove().catch(() => console.warn('[Net] signal_ack_failed'));
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.f !== 'string' || !members.has(m.f)) return;
      if (m.sig) {
        const sourceEpoch=epoch, previous=signalChains.get(m.f)||Promise.resolve();
        const next=previous.then(()=>{if(sourceEpoch===epoch && members.has(m.f)) return onSignal(m.f,m.sig);}).catch(()=>log('failed','signaling'));
        signalChains.set(m.f,next);
        next.finally(()=>{if(signalChains.get(m.f)===next) signalChains.delete(m.f);});
      }
      // 伺服器佇列只接受協商訊息；遊戲資料只走受限 DataChannel。
    });
    // Invitado: hueco para el anfitrión desde ya (se sustituye al llegar su
    // oferta). Así, si no llega nunca, se sigue por el relé y se sabe cuándo se va.
    if (!isHost) {
      const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
      p.timer = setTimeout(() => { if (p.mode === 'connecting') { p.mode = ALLOW_RELAY ? 'relay' : 'failed'; log('failed','timeout'); emitPeer(hostId); } }, DIRECT_TIMEOUT + 3000);
      peers.set(hostId, p);
    }
  }

  function close() {
    epoch++;
    for (const u of [...peers.keys()]) drop(u);
    if (qref) { qref.off(); qref = null; }
    pendingIce.clear(); signalChains.clear(); members.clear(); inbound.clear();
    roomId = null; isHost = false; hostUid = null;
  }

  /** El anfitrión llama a esto cuando cambian los miembros de la sala. */
  function syncMembers(uids) {
    if (!roomId) return;
    members.clear(); for (const u of uids) if (typeof u === 'string' && /^[a-f0-9]{32}$/.test(u)) members.add(u);
    if (isHost) {
      for (const u of uids) if (u !== uid && !peers.has(u)) connect(u);
      for (const u of [...peers.keys()]) if (!uids.includes(u)) drop(u);
    } else if (!uids.includes(hostUid)) {
      drop(hostUid);
    }
  }

  // ---------------- WebRTC ----------------

  function newPeer(u) {
    const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
    peers.set(u, p);
    // Sin WebRTC (navegador antiguo o bloqueado): directamente por el relé.
    let pc;
    try { pc = p.pc = new RTCPeerConnection({ iceServers: ICE }); }
    catch (e) { p.mode = 'failed'; log('failed','configuration'); emitPeer(u); return p; }
    const peerEpoch = epoch;
    pc.onicecandidate = e => { if (e.candidate && epoch === peerEpoch && peers.get(u) === p) signal(u, { c: e.candidate.toJSON() }); };
    log('connecting','none','unknown',u);
    pc.onconnectionstatechange = () => {
      if(peers.get(u)!==p) return;
      if(pc.connectionState==='disconnected') {
        log('disconnected','transport',p.route||'unknown',u);
        if(!p.disconnectTimer) p.disconnectTimer=setTimeout(()=>{p.disconnectTimer=0; if(peers.get(u)===p && pc.connectionState==='disconnected') useRelay(u,'transport');},DISCONNECT_GRACE);
      } else if(pc.connectionState==='connected') {
        if(p.disconnectTimer) log('recovered','none',p.route||'unknown',u);
        clearTimeout(p.disconnectTimer);p.disconnectTimer=0;
      } else if(pc.connectionState==='failed') useRelay(u,'transport');
    };
    // Si en unos segundos no hay canal directo, se sigue por el relé.
    p.timer = setTimeout(() => { if (p.mode === 'connecting') useRelay(u,'timeout'); }, DIRECT_TIMEOUT);
    emitPeer(u);
    return p;
  }

  function wireChannel(u, p, dc) {
    p.dc = dc;
    p.binaryVersion=0;dc.binaryType='arraybuffer';
    dc.onopen = () => {
      if(peers.get(u)!==p) return;
      clearTimeout(p.timer); p.mode = 'direct';
      try{dc.send(JSON.stringify({k:'net-cap',binary:G.NetCodec?.version||0}));}catch{console.warn('[Net] capability_send_failed');}
      log('connected','none','unknown',u); emitPeer(u);
      if(p.pc.getStats) p.pc.getStats().then(report=>{
        if(peers.get(u)!==p) return;
        for(const stat of report.values()) if(stat.type==='transport' && stat.selectedCandidatePairId) {
          const pair=report.get(stat.selectedCandidatePairId), local=pair&&report.get(pair.localCandidateId), remote=pair&&report.get(pair.remoteCandidateId);
          if(local?.candidateType && remote?.candidateType) {p.route=local.candidateType==='relay'||remote.candidateType==='relay'?'turn':'direct'; log('route','none',p.route,u);}
        }
      }).catch(()=>console.warn('[Net] route_detection_failed'));
    };
    dc.onclose = () => { if (peers.get(u)===p && p.mode === 'direct') useRelay(u,'channel'); };
    dc.onmessage = e => {
      if (peers.get(u) !== p || !members.has(u)) return;
      const now = performance.now();
      let b = inbound.get(u);
      if (!b || now - b.at >= 1000) { b = { at: now, n: 0, bytes: 0 }; inbound.set(u,b); }
      const bytes=typeof e.data==='string'?new TextEncoder().encode(e.data).byteLength:e.data?.byteLength;
      b.n++;b.bytes+=Number.isFinite(bytes)?bytes:G.NetProtocol.MAX_BYTES+1;
      if(b.n>120||b.bytes>2*1024*1024||!Number.isFinite(bytes)||bytes>G.NetProtocol.MAX_BYTES){log('failed','limit');drop(u);return;}
      let m;
      if(typeof e.data==='string'){
        try{const cap=JSON.parse(e.data);if(cap?.k==='net-cap'){
          if(Object.keys(cap).length!==2||!Number.isInteger(cap.binary))throw Error('capability');
          p.binaryVersion=cap.binary===G.NetCodec?.version?cap.binary:0;return;
        }}catch{log('failed','protocol');drop(u);return;}
        m=G.NetProtocol.parse(e.data,u===hostUid);
      }else{
        try{if(!G.NetCodec||p.binaryVersion!==G.NetCodec.version)throw Error('unnegotiated');m=G.NetCodec.decode(e.data);if(m?.k!=='f'||!G.NetProtocol.message(m,u===hostUid))throw Error('frame');stats.binaryRecv++;}
        catch{stats.invalidBinary++;log('failed','protocol');drop(u);return;}
      }
      if(!m){log('failed','protocol');drop(u);return;}stats.recvBytes+=bytes;
      deliver(u, m);
    };
  }

  function useRelay(u, reason = 'timeout') {
    const p = peers.get(u);
    if (!p || p.mode === 'closed' || p.mode === 'failed') return;
    if (ALLOW_RELAY) { p.mode = 'relay'; emitPeer(u); return; }
    // Sin relé: no se puede jugar con esa persona por ahora. El anfitrión reintenta.
    clearTimeout(p.timer);
    p.mode = 'failed';
    clearTimeout(p.disconnectTimer); log('failed',reason,p.route||'unknown',u);
    try { if (p.pc) p.pc.close(); } catch (e) { /* nada */ }
    emitPeer(u);
    if (isHost) p.timer = setTimeout(() => { if (peers.get(u) === p && p.mode === 'failed' && roomId) { log('retry','none','unknown',u); drop(u, true); connect(u); } }, RETRY_MS);
  }

  /** Anfitrión: abre conexión con un invitado. */
  async function connect(u) {
    if (!roomId || peers.has(u)) return;
    const openingEpoch = epoch;
    try { ICE = await G.Backend.iceServers(); } catch (e) {
      if (openingEpoch !== epoch || !roomId) return;
      console.warn('[Net] ice_configuration_failed');
      const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
      peers.set(u, p); useRelay(u,'configuration'); return;
    }
    if (!roomId || openingEpoch !== epoch || peers.has(u)) return;
    const p = newPeer(u);
    if (!p.pc) return;
    wireChannel(u, p, p.pc.createDataChannel('g', { ordered: true }));
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      if (openingEpoch !== epoch || !roomId) return;
      signal(u, { sdp: p.pc.localDescription.toJSON() });
    } catch (e) { if (openingEpoch === epoch) useRelay(u); }
  }

  const pendingIce = new Map();     // candidatos que llegan antes que la oferta

  async function onSignal(from, sig) {
    if (!members.has(from) || from === uid || (!isHost && from !== hostUid) || !sig || typeof sig !== 'object') return;
    const openingEpoch = epoch;
    let p = peers.get(from);
    try {
      if (sig.sdp && sig.sdp.type === 'offer') {
        if (isHost) return;
        const queued = pendingIce.get(from) || [];
        if (p) drop(from, true);
        pendingIce.set(from, queued);
        ICE = await G.Backend.iceServers();
        if (openingEpoch !== epoch || !roomId) return;
        p = newPeer(from);
        if (!p.pc) return;
        p.pc.ondatachannel = e => wireChannel(from, p, e.channel);
        await p.pc.setRemoteDescription(sig.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        if (openingEpoch !== epoch || !roomId) return;
        signal(from, { sdp: p.pc.localDescription.toJSON() });
        for (const c of queued) await p.pc.addIceCandidate(c).catch(() => console.warn('[Net] candidate_rejected'));
        pendingIce.delete(from);
      } else if (sig.sdp && sig.sdp.type === 'answer') {
        if (p && p.pc) {
          await p.pc.setRemoteDescription(sig.sdp);
          for(const c of pendingIce.get(from)||[]) await p.pc.addIceCandidate(c).catch(()=>console.warn('[Net] candidate_rejected'));
          pendingIce.delete(from);
        }
      } else if (sig.c) {
        if (p && p.pc && p.pc.remoteDescription) await p.pc.addIceCandidate(sig.c).catch(() => console.warn('[Net] candidate_rejected'));
        else {
          if (!pendingIce.has(from)) pendingIce.set(from, []);
          if (pendingIce.get(from).length < 64) pendingIce.get(from).push(sig.c);
          else { console.warn('[Net] ice_queue_full'); useRelay(from); }
        }
      }
    } catch (e) {
      if (openingEpoch !== epoch) return;
      console.warn('[Net] signaling_failed');
      useRelay(from,'signaling');
    }
  }

  function signal(to, sig) { relayPush(to, { f: uid, sig }); }

  function drop(u, silent) {
    pendingIce.delete(u); inbound.delete(u);
    const p = peers.get(u);
    if (!p) return;
    clearTimeout(p.timer); clearTimeout(p.disconnectTimer);
    log('closed','left',p.route||'unknown',u);
    p.mode = 'closed';
    try { if (p.dc) p.dc.close(); } catch (e) { /* nada */ }
    try { if (p.pc) p.pc.close(); } catch (e) { /* nada */ }
    peers.delete(u);
    if (!silent) emitPeer(u);
  }

  // ---------------- envío / recepción ----------------

  function relayPush(to, env) {
    if (!rtdb || !roomId) return;
    rtdb.ref('rooms/' + roomId + '/q/' + to).push(JSON.stringify(env)).catch(() => log('failed','send'));
  }

  function send(to, msg) {
    if (!roomId) return;
    const p = peers.get(to);
    stats.sent++;
    if (p && p.dc && p.dc.readyState === 'open') {
      try {
        const json=JSON.stringify(msg),jsonBytes=new TextEncoder().encode(json).byteLength;
        const packed=G.NetCodec&&p.binaryVersion===G.NetCodec.version&&msg?.k==='f'?G.NetCodec.encode(msg):null;
        const binary=packed&&packed.byteLength<jsonBytes;
        p.dc.send(binary?packed:json);stats.sentBytes+=binary?packed.byteLength:jsonBytes;stats.jsonBytes+=jsonBytes;if(binary)stats.binarySent++;return;
      } catch(e){log('failed','send',p.route||'unknown',to);}
    }
    // Sin relé, los datos de la partida no van por la base de datos (se pierden: esa
    // pareja no está conectada). Sólo pasa el aviso de empezar.
    if (!ALLOW_RELAY) { if(msg?.k==='start') log('failed','channel'); return; }
    stats.relaySent++;
    relayPush(to, { f: uid, d: msg });
  }

  function toHost(msg) { if (!isHost && hostUid) send(hostUid, msg); }
  function broadcast(msg, except) { for (const u of peers.keys()) if (u !== except) send(u, msg); }

  function deliver(from, msg) {
    if (!members.has(from) || !G.NetProtocol.message(msg, from === hostUid)) return;
    if (msg.k === 'start' && (isHost || from !== hostUid || msg.host !== hostUid || !msg.members.some(m => m.uid === uid) || msg.members.some(m => !members.has(m.uid)))) return;
    stats.recv++;
    handlers.forEach(fn => { try { fn(from, msg); } catch { console.error('[Net] message_handler_failed'); } });
  }

  return {
    open, close, syncMembers, send, toHost, broadcast,
    on(fn) { handlers.add(fn); }, off(fn) { handlers.delete(fn); },
    onPeer(fn) { peerHandlers.add(fn); },
    mode(u) { const p = peers.get(u); return p ? p.mode : 'closed'; },
    /** ¿Va por el relé (o no hay conexión)? Entonces se manda menos a menudo. */
    slow(u) { const p = peers.get(u); return !p || p.mode !== 'direct'; },
    peers() { return [...peers.keys()]; },
    get open_() { return !!roomId; },
    get isHost() { return isHost; },
    get uid() { return uid; },
    get hostUid() { return hostUid; },
    diagnostics: () => diagnostics.map(x=>({...x})),
    route: u => peers.get(u)?.route || 'unknown',
    stats
  };
})();
