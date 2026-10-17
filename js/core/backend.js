/* PostgreSQL HTTP 資料層。保留既有文件／交易呼叫介面，無 Firebase SDK 或服務依賴。 */
G.Backend = (() => {
  const timestamp = () => ({ __serverTimestamp: true });
  let gameRules=Object.freeze({eventBoostEnabled:false,gachaRates:[[1,45],[2,30],[3,17],[4,6.5],[5,1.5]],wildShinyRate:1/4096,riftShinyRate:1/512});
  function configureRules(r) {
    if(!r || typeof r.eventBoostEnabled!=='boolean' || !Array.isArray(r.gachaRates) || r.gachaRates.length!==5 || !r.gachaRates.every((pair,i)=>Array.isArray(pair)&&pair.length===2&&pair[0]===i+1&&Number.isFinite(pair[1])&&pair[1]>=0) || Math.abs(r.gachaRates.reduce((sum,p)=>sum+p[1],0)-100)>1e-9 || ![r.wildShinyRate,r.riftShinyRate].every(x=>Number.isFinite(x)&&x>0&&x<=1)) throw new Error('遊戲機率設定無效');
    gameRules=Object.freeze({...r,gachaRates:Object.freeze(r.gachaRates.map(p=>Object.freeze([...p])))});
  }
  let googleEnabled = false;
  let currentUser = null, disconnects = new Set(), ice = null, icePending = null;
  async function api(route, body = {}, options = {}) {
    const r = await fetch('/api/' + route, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), ...options });
    let data;
    try { data = await r.json(); } catch { throw Object.assign(new Error('伺服器回傳格式錯誤'), { code: 'unavailable' }); }
    if (!r.ok) throw Object.assign(new Error(data.error || '伺服器錯誤'), { code: data.error || 'unavailable' });
    return data;
  }
  function decodeEmail(email) {
    const hex = email.split('@')[0];
    return new TextDecoder().decode(new Uint8Array(hex.match(/../g).map(x => parseInt(x, 16))));
  }
  function attach(u) { currentUser = u; return { user: u }; }
  const auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged(fn) { let active = true; queueMicrotask(() => { if (active) fn(currentUser); }); return () => { active = false; }; },
    async createUserWithEmailAndPassword(email, password) { return attach((await api('auth/register', { name: decodeEmail(email), password })).user); },
    async signInWithEmailAndPassword(email, password) { return attach((await api('auth/login', { name: decodeEmail(email), password })).user); },
    async signOut() { await api('auth/logout'); currentUser = null; ice = null; }
  };
  class DocSnapshot {
    constructor(row) { this.ref = new Doc(row.path); this.id = this.ref.id; this.exists = row.data !== null; this.revision = row.revision; this.value = row.data; }
    data() { return this.value; }
  }
  function querySnapshot(rows, previous = new Map()) {
    const docs = rows.map(x => new DocSnapshot(x)), map = new Map(docs.map(x => [x.ref.path, x]));
    return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn),
      docChanges() {
        const changes = [];
        for (const d of docs) {
          const old = previous.get(d.ref.path);
          if (!old || old.revision !== d.revision) changes.push({ type: old ? 'modified' : 'added', doc: d });
        }
        for (const [p, d] of previous) if (!map.has(p)) changes.push({ type: 'removed', doc: d });
        return changes;
      }, _map: map };
  }
  function watch(load, fn, error, interval = 3000) {
    let stopped = false, timer, previous = new Map();
    const run = async () => {
      try {
        const value = await load(previous);
        if (!stopped) { if (value._map) previous = value._map; fn(value); }
      } catch (e) { if (!stopped) { if (error) error(e); else console.warn('[Backend] 訂閱失敗:', e.code || 'network'); } }
      if (!stopped) timer = setTimeout(run, interval);
    };
    run(); return () => { stopped = true; clearTimeout(timer); };
  }
  class Query {
    constructor(path, filters = [], order = null, count = 500, group = false) { Object.assign(this, { path, filters, order, count, group }); }
    where(...f) { return new Query(this.path, [...this.filters, f], this.order, this.count, this.group); }
    orderBy(field, direction = 'asc') { return new Query(this.path, this.filters, [field, direction], this.count, this.group); }
    limit(n) { return new Query(this.path, this.filters, this.order, n, this.group); }
    async get(previous) { const r = await api('documents', { op: 'query', path: this.path, filters: this.filters, order: this.order, limit: this.count, group: this.group }); return querySnapshot(r.docs, previous); }
    onSnapshot(fn, error) { return watch(p => this.get(p), fn, error); }
    doc(id) { return new Doc(this.path + '/' + id); }
  }
  class Doc {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    collection(name) { return new Query(this.path + '/' + name); }
    async get() { return new DocSnapshot(await api('documents', { op: 'get', path: this.path })); }
    set(data, options = {}) { return api('documents', { op: 'commit', reads: [], writes: [{ op: 'set', path: this.path, data, merge: !!options.merge }] }); }
    update(data) { return api('documents', { op: 'commit', reads: [], writes: [{ op: 'update', path: this.path, data }] }); }
    delete() { return api('documents', { op: 'commit', reads: [], writes: [{ op: 'delete', path: this.path }] }); }
    onSnapshot(fn, error) { return watch(() => this.get(), fn, error); }
  }
  const store = {
    collection: name => new Query(name), collectionGroup: name => new Query(name, [], null, 500, true),
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = [], writes = [];
        const result = await fn({
          async get(ref) { const s = await ref.get(); reads.push({ path: ref.path, revision: s.revision }); return s; },
          set(ref, data, opts = {}) { writes.push({ op: 'set', path: ref.path, data, merge: !!opts.merge }); },
          update(ref, data) { writes.push({ op: 'update', path: ref.path, data }); },
          delete(ref) { writes.push({ op: 'delete', path: ref.path }); }
        });
        try { await api('documents', { op: 'commit', reads, writes }); return result; }
        catch (e) { if (e.code !== 'conflict' || attempt === 4) throw e; }
      }
    }
  };
  const randomKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
  class RoomRef {
    constructor(path) { this.path = path; this.key = path.split('/').pop(); this.stops = []; }
    child(k) { return new RoomRef(this.path + '/' + k); }
    push(value) { const ref = this.child(randomKey()); return value === undefined ? ref : ref.set(value); }
    async get() {
      const { data } = await api('rooms', { op: 'get', path: this.path });
      return { val: () => data, exists: () => data !== null, numChildren: () => Object.keys(data || {}).length, key: this.key, ref: this };
    }
    set(data) { return api('rooms', { op: 'set', path: this.path, data }); }
    update(data) { return api('rooms', { op: 'update', path: this.path, data }); }
    remove() { return api('rooms', { op: 'remove', path: this.path }); }
    on(event, fn, error) {
      let seen = new Set(), last;
      const stop = watch(() => this.get(), snap => {
        const data = snap.val();
        if (event === 'child_added') {
          const next = new Set(Object.keys(data || {}));
          for (const k of next) if (!seen.has(k)) fn({ val: () => data[k], key: k, ref: this.child(k) });
          seen = next;
        } else if (JSON.stringify(data) !== last) { last = JSON.stringify(data); fn(snap); }
      }, error, this.path.includes('/q/') ? 500 : 2000);
      this.stops.push(stop); return fn;
    }
    off() { this.stops.forEach(fn => fn()); this.stops = []; }
    onDisconnect() { return { remove: () => { disconnects.add(this.path); return Promise.resolve(); }, cancel: () => { disconnects.delete(this.path); return Promise.resolve(); } }; }
  }
  const rooms = { ref: path => new RoomRef(path), goOnline() {}, goOffline() {} };
  addEventListener('pagehide', () => {
    for (const path of disconnects) api('rooms', { op: 'remove', path }, { keepalive: true }).catch(() => console.warn('[Backend] 離線房間將由租約清理'));
  });
  async function iceServers() {
    if (!ice || ice.expiresAt < Date.now() + 60000) {
      if (!icePending) icePending = api('ice-servers').then(data => {
        ice = { ...data, expiresAt: data.expiresAt || Date.now() + 600000 };
      }).finally(() => { icePending = null; });
      await icePending;
    }
    return ice.iceServers;
  }
  async function init() { const [config,session,rules] = await Promise.all([api('auth/config'),api('auth/session'),api('game-config')]); configureRules(rules); googleEnabled = config.googleEnabled === true; currentUser = session.user; return { auth, store, rooms }; }
  async function googleRedirect(action,password) {
    const returnTo = location.pathname.startsWith('/zh-TW') ? '/zh-TW/' : location.pathname.startsWith('/en') ? '/en/' : '/';
    const {url} = await api('auth/google/start',{action,password,returnTo});
    const target = new URL(url);
    if(target.origin !== 'https://accounts.google.com') throw new Error('Google 授權網址無效');
    location.assign(target.href);
    return {ok:true,redirecting:true};
  }
  return { api, timestamp, init, googleRedirect, get gameRules() { return gameRules; }, get googleEnabled() { return googleEnabled; }, iceServers, store, rooms, auth };
})();
