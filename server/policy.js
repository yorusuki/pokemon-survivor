'use strict';
const { address, read, fail } = require('./store');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max = 160) => typeof x === 'string' && x.length <= max;
const num = (x, max = 1e12) => Number.isFinite(x) && x >= 0 && x <= max;
const keys = (d, allowed) => object(d) && Object.keys(d).every(k => allowed.includes(k));
const members = (d, uid) => Array.isArray(d?.users) && d.users.includes(uid);
const pair = (a, b) => [a, b].sort().join('_');
function admin(uid) { return (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean).includes(uid); }
function canRead(path, d, uid) {
  const a = address(path);
  if (a.kind === 'saves' || a.kind === 'runs') return a.key === uid || admin(uid);
  if (a.kind === 'friendships') return !d || members(d, uid);
  if (a.kind === 'inv') return !d || d.to === uid || d.from === uid;
  if (a.kind === 'reports') return admin(uid);
  return true;
}
async function authorize(db, path, before, after, uid) {
  const a = address(path), own = a.key === uid, isAdmin = admin(uid);
  if (after !== null && (!object(after) || Buffer.byteLength(JSON.stringify(after)) > 512 * 1024)) fail('invalid-document');
  const d = after;
  let ok = false;
  switch (a.kind) {
    case 'saves':
      ok = own && (d === null || (keys(d, ['save', 'updatedAt', 'v', 'ban', 'sus']) && object(d.save) && Number.isInteger(d.v)
        && (d.save.name === undefined || (typeof d.save.name === 'string' && /^[\p{L}\p{N}_]{3,16}$/u.test(d.save.name)))
        && (d.save.stats === undefined || (object(d.save.stats) && Object.values(d.save.stats).every(Number.isFinite)))
        && num(d.save.coins) && num(d.save.tickets?.t1 ?? 0) && num(d.save.tickets?.t10 ?? 0)
        && !!d.ban === !!before?.ban));
      if (isAdmin && before && d && same(before.save, d.save)) ok = typeof d.ban === 'boolean';
      break;
    case 'profiles': {
      if (!d) { ok = own; break; }
      const reservation = str(d.lower, 16) ? (await read(db, 'names/' + d.lower)).data : null;
      ok = own && keys(d, ['name', 'lower', 'at', 'favs', 'title', 'best', 'medals'])
        && str(d.name, 16) && /^[\p{L}\p{N}_]{3,16}$/u.test(d.name) && d.lower === d.name.toLowerCase()
        && reservation?.uid === uid && (!d.favs || (Array.isArray(d.favs) && d.favs.length <= 3 && d.favs.every(n => Number.isInteger(n) && n >= 1 && n <= 1025)))
        && (!d.title || str(d.title, 40)) && (!d.medals || (Array.isArray(d.medals) && d.medals.length <= 8 && d.medals.every(x => str(x, 40))))
        && (!d.best || (object(d.best) && Object.values(d.best).every(n => num(n))));
      break;
    }
    case 'names': {
      ok = d === null ? before?.uid === uid : keys(d, ['uid']) && d.uid === uid && (!before || before.uid === uid)
        && /^[\p{L}\p{N}_]{3,16}$/u.test(a.key) && a.key === a.key.toLowerCase();
      if (ok && d && !before) ok = !(await db.query("SELECT id FROM names WHERE data->>'uid'=$1 AND id<>$2", [uid, a.key])).rowCount;
      break;
    }
    case 'pres':
      ok = own && (!d || (keys(d, ['on', 'at', 'room', 'play']) && typeof d.on === 'boolean' && typeof d.play === 'boolean' && str(d.room, 40)));
      break;
    case 'runs':
      ok = own && (!d || (keys(d, ['startedAt', 'mode']) && ['s', 'g'].includes(d.mode)));
      if (ok && d) d.startedAt = Date.now();
      break;
    case 'friendships':
      if (!d) ok = members(before, uid);
      else if (!before) ok = keys(d, ['users', 'from', 'to', 'status', 'names', 'at']) && d.from === uid && d.to !== uid
        && str(d.to) && d.status === 'pending' && Array.isArray(d.users) && d.users.length === 2
        && d.users.includes(uid) && d.users.includes(d.to) && a.key === pair(uid, d.to) && object(d.names)
        && !!(await db.query('SELECT id FROM users WHERE id=$1', [d.to])).rowCount;
      else ok = before.to === uid && before.status === 'pending' && d.status === 'ok'
        && same(before.users, d.users) && before.from === d.from && before.to === d.to
        && keys(d, ['users', 'from', 'to', 'status', 'names', 'at']);
      if (ok && d) ok = object(d.names) && Object.entries(d.names).every(([u, n]) => d.users.includes(u) && str(n, 16));
      break;
    case 'inv':
      if (!d) ok = before && (before.from === uid || before.to === uid);
      else if (keys(d, ['to', 'from', 'room', 'name', 'at']) && d.from === uid && str(d.to) && str(d.room, 40) && str(d.name, 16)
        && a.key === d.to + '_' + uid) {
        const f = (await read(db, 'friendships/' + pair(uid, d.to))).data;
        const room = await db.query('SELECT data FROM rooms WHERE id=$1', [d.room]);
        ok = f?.status === 'ok' && !!room.rows[0]?.data?.m?.[uid];
      }
      break;
    case 'lb': {
      if (!d) { ok = isAdmin || before?.uids?.includes(uid); break; }
      const run = (await read(db, 'runs/' + uid)).data;
      const save = (await read(db, 'saves/' + uid)).data;
      ok = keys(d, ['t', 'uids', 'names', 'dex', 'shiny', 'lv', 'kills', 'at']) && Array.isArray(d.uids) && d.uids.length >= 1 && d.uids.length <= 4
        && d.uids.includes(uid) && new Set(d.uids).size === d.uids.length
        && /^[sg]_[a-zA-Z0-9_-]{1,76}$/.test(a.board)
        && (a.board.startsWith('s_') ? d.uids.length === 1 && a.key === uid : d.uids.length >= 2 && a.key === [...d.uids].sort().join('_'))
        && Array.isArray(d.names) && d.names.length === d.uids.length && d.names.every(n => str(n, 16))
        && Array.isArray(d.dex) && d.dex.length === d.uids.length && d.dex.every(n => Number.isInteger(n) && n >= 1 && n <= 1025)
        && Array.isArray(d.shiny) && d.shiny.length === d.uids.length && d.shiny.every(x => typeof x === 'boolean')
        && num(d.t, 3600) && num(d.lv, 1000) && num(d.kills, 200000) && !save?.ban
        && run && d.t <= (Date.now() - run.startedAt) / 1000 + 30
        && (!before || (same(before.uids, d.uids) && d.t >= before.t));
      if (ok && d.uids.length > 1) {
        const rooms = await db.query('SELECT data FROM rooms WHERE data->>\'host\'=$1', [uid]);
        ok = rooms.rows.some(r => d.uids.every(u => r.data.m?.[u]));
      }
      break;
    }
    case 'lbs':
      // 前端摘要寫入是相容協定；真正 top 50 只由伺服器從合法成績重建。
      ok = !!d || isAdmin;
      break;
    case 'reports':
      ok = !d ? isAdmin : !before && keys(d, ['board', 'e', 'names', 't', 'by', 'at']) && d.by === uid && str(d.board, 40)
        && str(d.e, 160) && a.key === d.board + '__' + d.e + '__' + uid && Array.isArray(d.names) && d.names.length <= 4 && d.names.every(n => str(n,16)) && num(d.t, 3600);
      break;
  }
  if (!ok) fail('permission-denied', 403);
}
module.exports = { canRead, authorize, admin, object, str, num };
