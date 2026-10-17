'use strict';
const TABLES = Object.freeze({ saves: 'saves', profiles: 'profiles', names: 'names', friendships: 'friendships', pres: 'presence', inv: 'invitations', runs: 'runs', lb: 'leaderboard_entries', lbs: 'leaderboard_summaries', reports: 'reports' });
function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
function address(path) {
  if (typeof path !== 'string' || path.length > 260 || !/^[\p{L}\p{N}_./-]+$/u.test(path)) fail('invalid-path');
  const p = path.split('/');
  if (p.some(x => !x || x === '.' || x === '..')) fail('invalid-path');
  if (p[0] === 'lb' && p.length === 4 && p[2] === 'e') return { table: TABLES.lb, kind: 'lb', id: p.slice(1).join('/'), key: p[3], board: p[1] };
  if (p.length !== 2 || !Object.hasOwn(TABLES, p[0]) || p[0] === 'lb') fail('invalid-path');
  return { table: TABLES[p[0]], kind: p[0], id: p[1], key: p[1] };
}
async function read(db, path) {
  const a = address(path);
  const r = await db.query(`SELECT data, revision FROM ${a.table} WHERE id=$1`, [a.id]);
  return { path, data: r.rows[0]?.data ?? null, revision: r.rows[0]?.revision ?? 0 };
}
async function write(db, path, data) {
  const a = address(path);
  if (data === null) return db.query(`DELETE FROM ${a.table} WHERE id=$1`, [a.id]);
  await db.query(`INSERT INTO ${a.table}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2,revision=${a.table}.revision+1`, [a.id, data]);
}
function timestamps(value, now = Date.now(), depth = 0) {
  if (depth > 32) fail('document-too-deep');
  if (!value || typeof value !== 'object') return value;
  if (value.__serverTimestamp === true && Object.keys(value).length === 1) return now;
  if (Array.isArray(value)) return value.map(x => timestamps(x, now, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    if (['__proto__', 'prototype', 'constructor'].includes(k)) fail('invalid-field');
    return [k, timestamps(v, now, depth + 1)];
  }));
}
module.exports = { TABLES, address, read, write, timestamps, fail };
