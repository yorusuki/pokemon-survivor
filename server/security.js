'use strict';
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { fail } = require('./store');

function clientIP(req, secret) {
  const remote = req.socket.remoteAddress || 'unknown';
  const token = req.headers['x-ps-proxy-token'];
  if (!secret) return normalizeIP(remote);
  if (token === undefined) fail('invalid-proxy', 403);
  // 不信任任意 X-Forwarded-For／CF header；只接受持有內部 secret 的代理。
  if (typeof token !== 'string' || token.length > 256 || !crypto.timingSafeEqual(
    crypto.createHash('sha256').update(token).digest(), crypto.createHash('sha256').update(secret).digest()
  )) fail('invalid-proxy', 403);
  const ip = req.headers['x-ps-client-ip'];
  if (typeof ip !== 'string' || !isIP(ip)) fail('invalid-proxy', 403);
  return normalizeIP(ip);
}
function normalizeIP(ip) {
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  return isIP(ip) === 6 ? new URL('http://[' + ip + ']').hostname : ip;
}
function positiveSetting(value, fallback, max = 100000) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('無效的安全配額設定');
  return n;
}
function supportedRuntime(version) {
  const [major,minor,patch]=version.split('.').map(Number);
  // 已查詢的安全修補基線；部署仍須使用該受支援主版本的最新修補版。
  const floor={22:[23,2],24:[18,1],26:[5,1]}[major];
  return !!floor && (minor>floor[0] || (minor===floor[0] && patch>=floor[1]));
}
function createLimiter(maxKeys = 10000) {
  const buckets = new Map();
  function cleanup() { const now = Date.now(); for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k); }
  return {
    take(key, max, window = 60000) {
      const now = Date.now(), b = buckets.get(key);
      if (b && b.until > now) { if (++b.n > max) fail('too-many-requests', 429); return; }
      if (buckets.size >= maxKeys) { cleanup(); if (buckets.size >= maxKeys) fail('server-busy', 503); }
      buckets.set(key, { n: 1, until: now + window });
    }, cleanup
  };
}
function validateMember(m) {
  const allowed = ['name', 'dex', 'shiny', 'at'];
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !allowed.includes(k))
    || typeof m.name !== 'string' || !/^[\p{L}\p{N}_]{3,16}$/u.test(m.name)
    || !Number.isInteger(m.dex) || m.dex < 1 || m.dex > 1025 || typeof m.shiny !== 'boolean'
    || (m.at !== undefined && !Number.isFinite(m.at))) fail('invalid-member');
  return { name: m.name, dex: m.dex, shiny: m.shiny, at: m.at ?? Date.now() };
}
function validateSignal(sig, hostSending) {
  if (!sig || typeof sig !== 'object' || Array.isArray(sig) || Object.keys(sig).length !== 1) fail('invalid-signal');
  if (sig.sdp) {
    if (!sig.sdp || typeof sig.sdp !== 'object' || sig.sdp.type !== (hostSending ? 'offer' : 'answer')
      || typeof sig.sdp.sdp !== 'string' || sig.sdp.sdp.length > 24000
      || Object.keys(sig.sdp).some(k => !['type', 'sdp'].includes(k))) fail('invalid-signal');
  } else if (sig.c) {
    const c = sig.c;
    if (typeof c !== 'object' || Array.isArray(c) || typeof c.candidate !== 'string' || c.candidate.length > 2048
      || Object.keys(c).some(k => !['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(k))
      || (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 128))
      || (c.usernameFragment != null && (typeof c.usernameFragment !== 'string' || c.usernameFragment.length > 256))
      || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 32))) fail('invalid-signal');
  } else fail('invalid-signal');
}
function validateIceServers(servers) {
  if (!Array.isArray(servers) || !servers.length || servers.length > 12) fail('turn-provider-error', 502);
  return servers.map(s => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) fail('turn-provider-error', 502);
    const urls = typeof s.urls === 'string' ? [s.urls] : s.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 12 || !urls.every(u => typeof u === 'string' && u.length <= 512 && /^(?:stun|stuns|turn|turns):[a-zA-Z0-9.:[\]-]+(?:\?transport=(?:udp|tcp))?$/.test(u))) fail('turn-provider-error', 502);
    const result = { urls };
    if (urls.some(u => /^turns?:/.test(u))) {
      if (typeof s.username !== 'string' || s.username.length > 1024 || typeof s.credential !== 'string' || s.credential.length > 2048) fail('turn-provider-error', 502);
      result.username = s.username; result.credential = s.credential;
    }
    return result;
  });
}
async function consumeBudget(db, id, max) {
  const r = await db.query(`INSERT INTO security_limits(id,used,reset_at) VALUES($1,1,now()+interval '1 hour')
    ON CONFLICT(id) DO UPDATE SET used=CASE WHEN security_limits.reset_at<=now() THEN 1 ELSE security_limits.used+1 END,
      reset_at=CASE WHEN security_limits.reset_at<=now() THEN now()+interval '1 hour' ELSE security_limits.reset_at END
    WHERE security_limits.reset_at<=now() OR security_limits.used<$2 RETURNING used`, [id,max]);
  if (!r.rows.length) fail('too-many-requests',429);
}
async function assertRuntimeRole(db) {
  const role=(await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,has_schema_privilege(current_user,'public','CREATE') AS can_create,has_database_privilege(current_database(),'CREATE') AS can_create_schema,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=pg_roles.oid AND n.nspname='public') AS owns_objects,EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=pg_roles.oid) AS has_membership FROM pg_roles WHERE rolname=current_user")).rows[0];
  if (!role || Object.values(role).some(Boolean)) throw new Error('API 資料庫角色權限過大，請先執行 db-init 並檢查角色權限');
}
module.exports = { clientIP, createLimiter, positiveSetting, supportedRuntime, validateMember, validateSignal, validateIceServers, consumeBudget, assertRuntimeRole };
