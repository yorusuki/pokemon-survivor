/* 合作連線的輸入邊界：限制結構與資源，不驗證遊戲獎勵是否真實取得。 */
G.NetProtocol = (() => {
  const MAX_BYTES = 256 * 1024;
  const uid = x => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x);
  const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const num = x => Number.isFinite(x) && Math.abs(x) <= 1e12;
  const list = (x, max, fn) => Array.isArray(x) && x.length <= max && x.every(fn);
  const name = x => typeof x === 'string' && /^[\p{L}\p{N}_]{3,16}$/u.test(x);
  const events = new Set(['h','s','c','pb','lp','hs','he','re','bye','ne','ed','eg','hn','es','item','pk','pc','mag','bomb','say','heal','lu','lw','lr','hp','ha','sh','ov','rift','riftx','arena','aw','al','jd','jk','wx','ev','hz','fxr']);
  function bounded(value, depth = 0, budget = { n: 50000 }) {
    if (--budget.n < 0 || depth > 12) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return num(value);
    if (typeof value === 'string') return value.length <= 2048;
    if (Array.isArray(value)) return value.length <= 8192 && value.every(v => bounded(v, depth + 1, budget));
    return obj(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([k,v]) => !['__proto__','prototype','constructor'].includes(k) && k.length <= 128 && bounded(v, depth + 1, budget));
  }
  function state(a) { return Array.isArray(a) && a.length >= 13 && a.length <= 16 && a.every((v,i) => i===15 ? (v===''||uid(v)) : i === 7 ? typeof v === 'string' && v.length <= 80 : num(v)); }
  function event(e) {
    if (!Array.isArray(e) || e.length > 16 || !events.has(e[0])) return false;
    if(e[0]==='fxr' && !(e.length===5 && e.slice(1,4).every(Number.isFinite) && e[3]>=0 && e[3]<=2000 && typeof e[4]==='string' && e[4].length<=64))return false;
    if(e[0]==='s'&&e[2]==='t')return e.length===4&&Number.isSafeInteger(e[1])&&e[1]>0&&Number.isFinite(e[3])&&e[3]>0&&e[3]<=10;
    if(e[0]==='es' && !(e.length===9 || (e.length===10 && [null,'physical','special'].includes(e[9]))))return false;
    if(e[0]==='hz' && e[1]?.cat!==undefined && ![null,'physical','special'].includes(e[1].cat))return false;
    if (['lp','lr'].includes(e[0])) return e.length===2 && Number.isSafeInteger(e[1]) && e[1]>0;
    if (e[0] === 'ov') return obj(e[1]) && Object.entries(e[1]).every(([k,v]) => k === 'why' ? ['host','dead'].includes(v) : ['ki','bo','co','lv','t1','t10','t'].includes(k) && num(v));
    if (['lw','hp'].includes(e[0])) return list(e[1],4,x => typeof x === 'string' && x.length <= 32);
    return true;
  }
  function message(m, fromHost) {
    if (!obj(m) || !bounded(m)) return false;
    if (m.k === 'start') return fromHost && num(m.seed) && uid(m.host)
      && Object.keys(m).every(k => ['k','seed','host','members'].includes(k))
      && list(m.members,4,x => obj(x) && uid(x.uid) && name(x.name) && Number.isInteger(x.dex) && x.dex >= 1 && x.dex <= 1025
        && (!G.DEX_BY || !!G.DEX_BY[x.dex]) && typeof x.shiny === 'boolean'
        && Object.keys(x).every(k => ['uid','name','dex','shiny'].includes(k)))
      && m.members.length >= 2 && new Set(m.members.map(x => x.uid)).size === m.members.length;
    if (m.k !== 'f' || !list(m.ev || [],1024,event)) return false;
    if (!fromHost) return Object.keys(m).every(k => ['k','p','ev'].includes(k)) && state(m.p);
    if (!Object.keys(m).every(k => ['k','t','lv','xp','xn','ki','bo','co','tk','p','e','ev','ja','ho','lu'].includes(k))) return false;
    if (!['t','lv','xp','xn','ki','bo','co'].every(k => num(m[k]))) return false;
    return obj(m.p) && Object.keys(m.p).length <= 4 && Object.entries(m.p).every(([u,s]) => uid(u) && state(s))
      && list(m.e || [],2000,a => Array.isArray(a) && a.length === 7 && a.every(num))
      && (m.tk === undefined || list(m.tk,2,num)) && (m.ja === undefined || list(m.ja,4,num))
      && (m.lu === undefined || list(m.lu,2,num)) && (m.ho === undefined || list(m.ho,4,x => typeof x === 'string' && x.length <= 32));
  }
  function parse(raw, fromHost) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) return null;
    try { const m = JSON.parse(raw); return message(m, fromHost) ? m : null; } catch { return null; }
  }
  return { MAX_BYTES, parse, message };
})();
