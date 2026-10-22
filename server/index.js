'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const { TABLES, address, read, write, timestamps, fail } = require('./store');
const { canRead, authorize, admin, object, str } = require('./policy');
const { clientIP, createLimiter, positiveSetting, supportedRuntime, validateMember, validateSignal, validateIceServers, consumeBudget, assertRuntimeRole } = require('./security');
const scrypt = promisify(crypto.scrypt);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const { createGoogleAuth } = require('./google-auth');
const { gameConfig } = require('./game-config');
const { createAccounts } = require('./accounts');
const SESSION_MS = 30 * 86400000;
const LIMIT = 768 * 1024;
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function verifyPassword(password, stored) {
  const candidate = await hashPassword(password, stored.split(':')[0]);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}
const cleanName = n => typeof n === 'string' && /^[\p{L}\p{N}_]{3,16}$/u.test(n);
function validateCredentials(b) {
  if (!cleanName(b.name) || typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) fail('invalid-credentials');
}
function userInfo(row) { return { uid: row.id, displayName: row.display_name, email: row.password_hash ? Buffer.from(row.login).toString('hex') + '@jugadores.pokesurvivor.net' : '', hasPassword: !!row.password_hash, providerData: row.google_linked ? [{ providerId: 'google.com' }] : [], isAdmin: admin(row.id) }; }
function createApp(pool, options = {}) {
  const origin = options.origin || process.env.APP_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN 必須為完整且不含尾斜線的網站 origin');
  const gameRules=gameConfig(options.eventBoost ?? process.env.GAME_EVENT_BOOST_ENABLED ?? 'false');
  const secure = origin.startsWith('https://');
  const turnFetch = options.turnFetch || fetch;
  const proxySecret = options.proxySecret ?? process.env.API_PROXY_SECRET ?? '';
  if (proxySecret && (proxySecret.length < 32 || proxySecret.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(proxySecret))) throw new Error('API_PROXY_SECRET 必須為 32～128 個英數字、底線或連字號');
  const limiter = createLimiter();
  const turnBudget = positiveSetting(options.turnBudget ?? process.env.TURN_CREDENTIALS_PER_HOUR, 300);
  const registrationBudget = positiveSetting(process.env.REGISTRATIONS_PER_HOUR, 100);
  const maxInFlight = positiveSetting(options.maxInFlight, 64, 256);
  let inFlight = 0;
  let hashing = 0;
  const cookie = (token, age = SESSION_MS / 1000) => `ps_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  function rate(key, max, window = 60000) {
    limiter.take(key, max, window);
  }
  async function passwordTask(fn) {
    if (hashing >= 8) fail('server-busy', 503);
    hashing++;
    try { return await fn(); } finally { hashing--; }
  }
  async function session(req) {
    const token = /(?:^|;\s*)ps_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return (await pool.query('SELECT u.*, EXISTS(SELECT 1 FROM google_identities g WHERE g.user_id=u.id) AS google_linked FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [sha(token)])).rows[0] || null;
  }
  async function issue(res, u) {
    const token = crypto.randomBytes(32).toString('hex');
    await transaction(async db => {
      await db.query('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=$1 ORDER BY expires_at DESC,token_hash OFFSET 19)', [u.id]);
      await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sha(token), u.id, new Date(Date.now() + SESSION_MS)]);
    });
    res.setHeader('Set-Cookie', cookie(token));
  }
  async function transaction(fn) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // 舊前端的跨文件交易需要原子操作；單一短期交易鎖避免不存在資料列的競爭。
      await db.query("SELECT pg_advisory_xact_lock(148062,1)");
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    finally { db.release(); }
  }
  async function deleteUser(db, uid) {
    await db.query("DELETE FROM names WHERE data->>'uid'=$1", [uid]);
    await db.query("DELETE FROM friendships WHERE data->'users' @> $1::jsonb", [JSON.stringify([uid])]);
    await db.query("DELETE FROM invitations WHERE data->>'to'=$1 OR data->>'from'=$1", [uid]);
    const rows = await db.query("DELETE FROM leaderboard_entries WHERE data->'uids' @> $1::jsonb RETURNING id", [JSON.stringify([uid])]);
    for (const board of new Set(rows.rows.map(r => r.id.split('/')[0]))) await rebuild(db, board);
    await db.query("DELETE FROM reports WHERE data->>'by'=$1", [uid]);
    await db.query("DELETE FROM rooms WHERE data->>'host'=$1", [uid]);
    await db.query("UPDATE rooms SET data=data #- ARRAY['m',$1] #- ARRAY['_seen',$1] #- ARRAY['q',$1],revision=revision+1 WHERE data->'m' ? $1", [uid]);
    await db.query('DELETE FROM users WHERE id=$1', [uid]);
  }
  const google = createGoogleAuth({ pool, origin, options, transaction, issue, cookie, rate, passwordTask, verifyPassword, deleteUser, registrationBudget });
  const accounts = createAccounts({ pool, transaction, rate, clock: options.accountClock });
  async function rebuild(db, board) {
    const r = await db.query("SELECT id,data FROM leaderboard_entries WHERE id LIKE $1 ESCAPE '!' ORDER BY (data->>'t')::numeric DESC,id LIMIT 50", [board.replace(/[!_%]/g, x => '!' + x) + '/e/%']);
    const top = Object.fromEntries(r.rows.map(r => [r.id.split('/')[2], r.data]));
    await write(db, 'lbs/' + board, { top, me: '', ev: '' });
  }
  async function documents(b, uid) {
    if (b.op === 'get') {
      const r = await read(pool, b.path);
      if (!canRead(b.path, r.data, uid)) fail('permission-denied', 403);
      if (b.path.startsWith('friendships/') && r.data) return (await accounts.projectFriends([r]))[0];
      return r;
    }
    if (b.op === 'query') {
      if (!str(b.path, 200) || !Array.isArray(b.filters) || b.filters.length > 5 || !Number.isInteger(b.limit) || b.limit < 1 || b.limit > 500) fail('invalid-query');
      let kind = b.path, prefix = '';
      if (/^lb\/[a-zA-Z0-9_-]+\/e$/.test(kind)) { prefix = kind.slice(3) + '/'; kind = 'lb'; }
      if (b.group === true && kind === 'e') kind = 'lb';
      if (!Object.hasOwn(TABLES, kind)) fail('invalid-query');
      // 敏感集合必須由 SQL 先限縮到登入者，不下載其他玩家的私有資料。
      const args = [], cond = [];
      function arg(v) { args.push(v); return '$' + args.length; }
      if (!admin(uid)) {
        if (['saves', 'runs'].includes(kind)) cond.push('id=' + arg(uid));
        if (kind === 'friendships') cond.push("data->'users' @> " + arg(JSON.stringify([uid])) + '::jsonb');
        if (kind === 'inv') { const u = arg(uid); cond.push(`(data->>'to'=${u} OR data->>'from'=${u})`); }
        if (kind === 'reports') fail('permission-denied', 403);
      }
      if (prefix) cond.push('id LIKE ' + arg(prefix.replace(/[!_%]/g, x => '!' + x) + '%') + " ESCAPE '!'");
      for (const f of b.filters) {
        if (!Array.isArray(f) || f.length !== 3 || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(f[0])) fail('invalid-query');
        const field = arg(f[0]), val = arg(JSON.stringify(f[2]));
        if (f[1] === '==') cond.push(`data->${field}=${val}::jsonb`);
        else if (f[1] === 'array-contains') { args[args.length - 1] = JSON.stringify([f[2]]); cond.push(`data->${field} @> ${val}::jsonb`); }
        else if (f[1] === 'in' && Array.isArray(f[2]) && f[2].length <= 30) cond.push(`${val}::jsonb @> jsonb_build_array(data->${field})`);
        else if (['>', '>=', '<', '<='].includes(f[1]) && typeof f[2] === 'number') cond.push(`data->${field} ${f[1]} ${val}::jsonb`);
        else fail('invalid-query');
      }
      let order = 'id';
      if (b.order) {
        if (!Array.isArray(b.order) || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(b.order[0]) || !['asc', 'desc'].includes(b.order[1])) fail('invalid-query');
        order = 'data->' + arg(b.order[0]) + ' ' + b.order[1] + ',id';
      }
      const r = await pool.query(`SELECT id,data,revision FROM ${TABLES[kind]} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY ${order} LIMIT ${arg(b.limit)}`, args);
      const rows = kind === 'friendships' ? await accounts.projectFriends(r.rows) : r.rows;
      return { docs: rows.map(r => ({ path: kind === 'lb' ? 'lb/' + r.id : b.path + '/' + r.id, data: r.data, revision: r.revision })) };
    }
    if (b.op !== 'commit' || !Array.isArray(b.writes) || b.writes.length > 100 || !Array.isArray(b.reads) || b.reads.length > 100) fail('invalid-operation');
    return transaction(async db => {
      for (const expected of b.reads) {
        if (!object(expected)) fail('invalid-operation');
        const r = await read(db, expected.path);
        if (!canRead(expected.path, r.data, uid)) fail('permission-denied', 403);
        if (r.revision !== expected.revision) fail('conflict', 409);
      }
      const boards = new Set();
      for (const w of b.writes) {
        if (!object(w)) fail('invalid-operation');
        if (!['set', 'update', 'delete'].includes(w.op)) fail('invalid-operation');
        if (w.op !== 'delete' && !object(w.data)) fail('invalid-document');
        const a = address(w.path), old = (await read(db, w.path)).data;
        if (w.op === 'update' && !old) fail('not-found', 404);
        let next = w.op === 'delete' ? null : timestamps(w.data);
        if (w.op === 'update' || w.merge) {
          const patch = next; next = structuredClone(old || {});
          for (const [key, value] of Object.entries(patch)) {
            const parts = key.split('.');
            if (parts.some(p => !p || ['__proto__', 'prototype', 'constructor'].includes(p))) fail('invalid-field');
            let target = next;
            for (const part of parts.slice(0, -1)) { if (!object(target[part])) target[part] = {}; target = target[part]; }
            target[parts.at(-1)] = value;
          }
        }
        if (next && ['profiles', 'pres', 'friendships', 'inv', 'lb', 'reports'].includes(a.kind)) next.at = Date.now();
        if (next && a.kind === 'saves') next.updatedAt = Date.now();
        if (next && a.kind === 'saves' && object(next.save)) {
          const profile = (await read(db, 'profiles/' + a.key)).data;
          if (profile) next.save.name = profile.name;
        }
        if (next && !old && a.kind === 'reports') {
          rate('report:' + uid, 20, 3600000);
          const count = await db.query("SELECT count(*) FROM reports WHERE data->>'by'=$1", [uid]);
          if (Number(count.rows[0].count) >= 200) fail('report-quota', 429);
        }
        // 刪除不存在的文件仍須通過自己的命名空間授權。
        if (!old && !next && ['names', 'friendships', 'inv', 'lb', 'reports'].includes(a.kind)) continue;
        await authorize(db, w.path, old, next, uid);
        if (a.kind !== 'lbs') await write(db, w.path, next);
        if (a.kind === 'lb') boards.add(a.board);
      }
      for (const b of boards) await rebuild(db, b);
      return { ok: true };
    });
  }
  async function roomOperation(b, uid) {
    if (typeof b.path !== 'string' || !/^rooms\/[a-zA-Z0-9_-]{6,80}(\/(m|host|open|q)(\/[a-zA-Z0-9_-]{1,80}){0,2})?$/.test(b.path)) fail('invalid-room-path');
    const [, id, ...parts] = b.path.split('/');
    if ([id, ...parts].some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) fail('invalid-room-path');
    return transaction(async db => {
      let room = (await db.query('SELECT data FROM rooms WHERE id=$1 FOR UPDATE', [id])).rows[0]?.data || null;
      if (room && Date.now() - (room._seen?.[room.host] || 0) > 90000) {
        await db.query('DELETE FROM rooms WHERE id=$1', [id]); room = null;
      }
      if (room) for (const u of Object.keys(room.m || {})) {
        if (u !== room.host && Date.now() - (room._seen?.[u] || 0) > 90000) { delete room.m[u]; delete room._seen[u]; }
      }
      const member = !!room?.m?.[uid];
      if (b.op === 'get') {
        if (!member && !(parts.length === 1 && ['host', 'open'].includes(parts[0]))) fail('permission-denied', 403);
        if (parts[0] === 'q' && (parts.length !== 2 || parts[1] !== uid)) fail('permission-denied', 403);
        if (!parts.length || !['m', 'host', 'open', 'q'].includes(parts[0])) fail('permission-denied', 403);
        let data = room;
        for (const p of parts) data = data?.[p] ?? null;
        if (member) {
          room._seen[uid] = Date.now();
          await db.query('UPDATE rooms SET data=$2,touched_at=now() WHERE id=$1', [id, room]);
        }
        return { data };
      }
      if (!['set', 'update', 'remove'].includes(b.op)) fail('invalid-operation');
      let data = b.op === 'remove' ? null : timestamps(b.data);
      if (Buffer.byteLength(JSON.stringify(data)) > 200000) fail('room-message-too-large');
      if (!parts.length) {
        if (data === null) { if (room && room.host !== uid) fail('permission-denied', 403); }
        else {
          if (room || !object(data) || data.host !== uid || data.open !== true || Object.keys(data.m || {}).join() !== uid) fail('permission-denied', 403);
          const count = await db.query("SELECT count(*) FROM rooms WHERE data->>'host'=$1", [uid]);
          if (Number(count.rows[0].count) >= 2) fail('room-quota', 429);
          const m = validateMember(data.m[uid]);
          room = { host: uid, open: true, at: Date.now(), m: { [uid]: m }, q: {}, _seen: { [uid]: Date.now() } };
        }
        if (!data) { await db.query('DELETE FROM rooms WHERE id=$1', [id]); return { ok: true }; }
      } else {
        if (!room) fail('room-not-found', 404);
        if(parts[0]==='m'&&parts.length===2&&parts[1]!==uid&&room.host===uid&&b.op==='remove') {
          if(!room.m[parts[1]])return {ok:true};
          delete room.m[parts[1]];delete room._seen[parts[1]];if(room.q)delete room.q[parts[1]];
        } else if (parts[0] === 'm' && parts.length === 2 && parts[1] === uid) {
          if (data && (!member && (!room.open || Object.keys(room.m).length >= 4))) fail('room-full', 409);
          if (data && b.op === 'update' && member) data = { ...room.m[uid], ...data };
          if (data) data = validateMember(data);
          if (!data) { delete room.m[uid]; delete room._seen[uid]; }
          else { room.m[uid] = data; room._seen[uid] = Date.now(); }
        } else if (parts[0] === 'open' && parts.length === 1 && room.host === uid && typeof data === 'boolean') room.open = data;
        else if (parts[0] === 'q' && parts.length === 3 && member && room.m[parts[1]]) {
          if (data === null) {
            if (parts[1] !== uid) fail('permission-denied', 403);
            if (room.q?.[uid]) delete room.q[uid][parts[2]];
          } else {
            if (typeof data !== 'string' || data.length > 32768) fail('invalid-signal');
            let env; try { env = JSON.parse(data); } catch { fail('invalid-signal'); }
            if (!object(env) || env.f !== uid || !object(env.sig) || Object.keys(env).some(k => !['f','sig'].includes(k))) fail('invalid-signal', 403);
            if (parts[1] === uid || (uid !== room.host && parts[1] !== room.host)) fail('invalid-signal', 403);
            validateSignal(env.sig, uid === room.host);
            rate('signal:' + uid, 600);
            room.q ||= {}; room.q[parts[1]] ||= {};
            if (Object.keys(room.q[parts[1]]).length >= 64) fail('signal-queue-full', 429);
            room.q[parts[1]][parts[2]] = data;
          }
        } else fail('permission-denied', 403);
      }
      await db.query('INSERT INTO rooms(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2,revision=rooms.revision+1,touched_at=now()', [id, room]);
      return { ok: true };
    });
  }
  async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      let url; try { url = new URL(req.url, origin); } catch { fail('invalid-url'); }
      if (url.pathname === '/api/health' && req.method === 'GET') { rate('health-global', 600); await pool.query('SELECT 1'); return send(res, 200, { ok: true }); }
      if (!url.pathname.startsWith('/api/')) fail('not-found', 404);
      if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') {
        const ip = clientIP(req, proxySecret); rate('google-callback:' + ip, 60, 600000);
        return await google.callback(req, res, url);
      }
      if (req.method !== 'POST') fail('method-not-allowed', 405);
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') fail('invalid-origin', 403);
      if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('invalid-content-type', 415);
      const ip = clientIP(req, proxySecret);
      rate('global-request', 30000);
      rate('request:' + ip, 3000);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > LIMIT) fail('payload-too-large', 413); chunks.push(chunk); }
      let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid-json'); }
      if (!object(b)) fail('invalid-body');
      const u = await session(req);
      if (url.pathname === '/api/game-config') return send(res,200,gameRules);
      if (url.pathname === '/api/auth/config') return send(res, 200, { googleEnabled: google.enabled });
      if (url.pathname === '/api/auth/google/start') return send(res, 200, await google.start(req,res,b,u,ip));
      if (url.pathname === '/api/auth/google/complete') return send(res, 200, await google.complete(req,res,b,u));
      if (url.pathname === '/api/auth/session') return send(res, 200, { user: u ? userInfo(u) : null });
      if (['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
        rate('auth:' + ip, 30, 15 * 60000);
        rate('global-auth', 300);
        validateCredentials(b);
        rate('account:' + sha(b.name.toLowerCase()), 60, 15 * 60000);
        let row;
        if (url.pathname.endsWith('register')) {
          await consumeBudget(pool, 'registration', registrationBudget);
          const id = crypto.randomBytes(16).toString('hex'), hash = await passwordTask(() => hashPassword(b.password));
          try { row = (await pool.query('INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING *', [id, b.name.toLowerCase(), b.name, hash])).rows[0]; }
          catch (e) { if (e.code === '23505') fail('auth/email-already-in-use', 409); throw e; }
        } else {
          row = (await pool.query('SELECT u.*, EXISTS(SELECT 1 FROM google_identities g WHERE g.user_id=u.id) AS google_linked FROM users u WHERE login=$1', [b.name.toLowerCase()])).rows[0];
          const valid = await passwordTask(() => verifyPassword(b.password, row?.password_hash || ('0'.repeat(32) + ':' + '0'.repeat(128))));
          if (!row?.password_hash || !valid) fail('auth/invalid-credential', 401);
        }
        await issue(res, row); return send(res, 200, { user: userInfo(row) });
      }
      if (!u) fail('auth/invalid-credential', 401);
      rate('user:' + u.id, 2400);
      if (url.pathname === '/api/account') return send(res, 200, await accounts.operation(b, u.id));
      if (url.pathname === '/api/auth/logout') {
        const token = /ps_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
        if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [sha(token)]);
        res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/auth/delete') {
        rate('delete-auth:' + u.id, 10, 15 * 60000);
        if (!u.password_hash || typeof b.password !== 'string' || b.password.length > 128 || !await passwordTask(() => verifyPassword(b.password, u.password_hash))) fail('auth/invalid-credential', 401);
        await transaction(async db => {
          await deleteUser(db, u.id);
        });
        res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/documents') return send(res, 200, await documents(b, u.id));
      if (url.pathname === '/api/rooms') return send(res, 200, await roomOperation(b, u.id));
      if (url.pathname === '/api/ranking/count') {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(b.board) || !Number.isFinite(b.time)) fail('invalid-query');
        const r = await pool.query("SELECT count(*) FROM leaderboard_entries WHERE split_part(id,'/',1)=$1 AND (data->>'t')::numeric>$2", [b.board, b.time]);
        return send(res, 200, { count: Number(r.rows[0].count) });
      }
      if (url.pathname === '/api/network-events') {
        const events = ['connecting','connected','disconnected','recovered','failed','closed','retry','route'];
        const reasons = ['none','timeout','transport','channel','configuration','signaling','protocol','limit','send','left'];
        if ((b.peer !== undefined && b.peer !== '' && (typeof b.peer !== 'string' || !/^[a-f0-9]{32}$/.test(b.peer))) || !events.includes(b.event) || !reasons.includes(b.reason) || !['unknown','direct','turn'].includes(b.route)) fail('invalid-network-event');
        rate('network-events:' + u.id, 30);
        console.info(JSON.stringify({event:'multiplayer_network', userId:u.id, state:b.event, reason:b.reason, route:b.route, peerId:b.peer||null}));
        return send(res,200,{ok:true});
      }
      if (url.pathname === '/api/ice-servers') {
        rate('turn:' + u.id, 60, 3600000);
        const key = process.env.CLOUDFLARE_TURN_KEY_ID, token = process.env.CLOUDFLARE_TURN_API_TOKEN;
        if (!key && !token) return send(res, 200, { turn: false, iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] });
        if (!key || !token || !/^[a-fA-F0-9-]{16,80}$/.test(key)) fail('turn-configuration-error', 503);
        await consumeBudget(pool, 'turn', turnBudget);
        const r = await turnFetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 7200, customIdentifier: u.id }), signal: AbortSignal.timeout(10000)
        });
        if (!r.ok) fail('turn-provider-error', 502);
        const data = await r.json();
        const iceServers = validateIceServers(data.iceServers);
        return send(res, 200, { turn: true, iceServers, expiresAt: Date.now() + 7200000 });
      }
      fail('not-found', 404);
    } catch (e) {
      if (!e.status) console.error(JSON.stringify({ event: 'request_failed', type: e.name, code: /^[a-zA-Z0-9_-]{1,40}$/.test(e.code || '') ? e.code : 'internal' }));
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.code : 'internal-error' });
      else res.end();
    }
  }
  const timer = setInterval(() => {
    limiter.cleanup();
    pool.query('DELETE FROM oauth_flows WHERE expires_at<now()').catch(() => console.error('oauth_cleanup_failed'));
    pool.query('DELETE FROM sessions WHERE expires_at<now()').catch(() => console.error('session_cleanup_failed'));
    pool.query('DELETE FROM nickname_holds WHERE expires_at<=$1',[Date.now()]).catch(() => console.error('nickname_cleanup_failed'));
    pool.query("DELETE FROM rooms WHERE touched_at<now()-interval '5 minutes'").catch(() => console.error('room_cleanup_failed'));
  }, 60000);
  timer.unref();
  const server = http.createServer((req,res) => {
    // 連線關閉不會提前釋放仍在執行的 DB 工作，避免斷線重試灌滿 pool 等待佇列。
    if (inFlight >= maxInFlight) {
      req.resume(); res.setHeader('Connection','close');
      send(res,503,{error:'server-busy'}); return;
    }
    inFlight++;
    handler(req,res).catch(() => {
      console.error('request_handler_failed');
      if (!res.headersSent && !res.destroyed) send(res,500,{error:'internal-error'});
    }).finally(() => { inFlight--; });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => clearInterval(timer));
  return server;
}
function send(res, status, body) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.writeHead(status); res.end(JSON.stringify(body));
}
async function main() {
  if (!supportedRuntime(process.versions.node)) throw new Error('請使用最新安全修補的 Node.js 22／24／26（最低基線：22.23.2／24.18.1／26.5.1）');
  if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('缺少 DATABASE_URL 或 PostgreSQL 環境設定');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, statement_timeout: 10000 });
  pool.on('error', () => console.error('database_connection_failed'));
  if (!process.env.API_PROXY_SECRET) throw new Error('缺少 API_PROXY_SECRET');
  if (process.env.API_PROXY_SECRET === process.env.PGPASSWORD) throw new Error('代理驗證與資料庫密碼必須不同');
  // Runtime 不執行 DDL，也不得使用初始化 owner／superuser。
  await assertRuntimeRole(pool);
  await pool.query('SELECT id FROM users LIMIT 0');
  await pool.query('SELECT id FROM security_limits LIMIT 0');
  await pool.query('SELECT google_sub FROM google_identities LIMIT 0');
  await pool.query('SELECT state_hash FROM oauth_flows LIMIT 0');
  const server = createApp(pool);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('API listening'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => pool.end()));
}
if (require.main === module) main().catch(e => { console.error('startup_failed:', e.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
module.exports = { createApp, hashPassword, verifyPassword, validateCredentials };
