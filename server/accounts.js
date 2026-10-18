'use strict';
const crypto = require('node:crypto');
const { read, write, fail } = require('./store');
const DAY = 86400000;
function nickname(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}_]{3,16}$/u.test(value)
    && value.length <= 16 && value.toLowerCase().length <= 16
    && /^[\p{L}\p{N}_]{3,16}$/u.test(value.toLowerCase());
}
function createAccounts({ pool, transaction, rate, clock = Date.now }) {
  async function settings(db, uid) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = (await db.query('SELECT * FROM account_settings WHERE user_id=$1', [uid])).rows[0];
      if (old) return old;
      const code = 'PS-' + crypto.randomBytes(10).toString('hex').toUpperCase();
      await db.query('INSERT INTO account_settings(user_id,friend_code) VALUES($1,$2) ON CONFLICT DO NOTHING', [uid, code]);
    }
    fail('account-unavailable', 503);
  }
  async function view(db, uid) {
    const state = await settings(db, uid);
    const user = (await db.query('SELECT login,display_name,password_hash IS NOT NULL AS has_password FROM users WHERE id=$1', [uid])).rows[0];
    const profile = (await read(db, 'profiles/' + uid)).data;
    return { name: profile?.name || user.display_name, hasNickname:!!profile, loginName: user.has_password ? user.login : null,
      friendCode: state.friend_code, nextRenameAt: state.renamed_at === null ? 0 : Number(state.renamed_at) + DAY };
  }
  async function operation(b, uid) {
    const specs={get:['action'],lookup:['action','code'],rename:['action','name']};
    const fields=typeof b.action==='string' && Object.hasOwn(specs,b.action)?specs[b.action]:null;
    if(!fields || Object.keys(b).some(k=>!fields.includes(k)))fail('invalid-account-operation');
    if (b.action === 'get') return transaction(db => view(db, uid));
    if (b.action === 'lookup') {
      rate('friend-lookup:' + uid, 20);
      if (typeof b.code !== 'string' || !/^PS-[A-F0-9]{20}$/.test(b.code)) fail('invalid-friend-code');
      const result = await pool.query("SELECT u.id,p.data->>'name' AS name FROM account_settings a JOIN users u ON u.id=a.user_id JOIN profiles p ON p.id=u.id WHERE a.friend_code=$1", [b.code]);
      if (!result.rows.length) fail('friend-not-found', 404);
      return { uid: result.rows[0].id, name: result.rows[0].name };
    }
    if (b.action !== 'rename' || !nickname(b.name)) fail('invalid-nickname');
    rate('rename:' + uid, 10, DAY);
    return transaction(async db => {
      const now = clock(), lower = b.name.toLowerCase();
      const busy = await db.query("SELECT 1 FROM rooms WHERE data->'m' ? $1 AND (data->'_seen'->>$1)::numeric > $2 LIMIT 1", [uid, now - 90000]);
      if (busy.rows.length) fail('rename-in-room', 409);
      const state = await settings(db, uid), old = (await read(db, 'profiles/' + uid)).data;
      if (old?.name === b.name) return view(db, uid);
      if (state.renamed_at !== null && now < Number(state.renamed_at) + DAY) fail('rename-cooldown', 429);
      await db.query('DELETE FROM nickname_holds WHERE expires_at<=$1', [now]);
      const taken = (await read(db, 'names/' + lower)).data;
      const held = (await db.query('SELECT user_id FROM nickname_holds WHERE lower_name=$1 AND expires_at>$2', [lower, now])).rows[0];
      if ((taken && taken.uid !== uid) || (held && held.user_id !== uid)) fail('nickname-taken', 409);
      // Initial naming has no cooldown; subsequent public name changes are rate limited.
      if (old && old.lower !== lower) {
        await db.query('INSERT INTO nickname_holds(lower_name,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT(lower_name) DO UPDATE SET user_id=$2,expires_at=$3', [old.lower, uid, now + 7 * DAY]);
        await write(db, 'names/' + old.lower, null);
      }
      await db.query('DELETE FROM nickname_holds WHERE lower_name=$1 AND user_id=$2', [lower, uid]);
      await write(db, 'names/' + lower, { uid });
      await write(db, 'profiles/' + uid, { ...old, name: b.name, lower, at: now });
      await db.query('UPDATE users SET display_name=$2 WHERE id=$1', [uid, b.name]);
      await db.query("UPDATE saves SET data=jsonb_set(data,'{save,name}',to_jsonb($2::text)),revision=revision+1 WHERE id=$1 AND jsonb_typeof(data->'save')='object'", [uid, b.name]);
      await db.query("UPDATE invitations SET data=jsonb_set(data,'{name}',to_jsonb($2::text)),revision=revision+1 WHERE data->>'from'=$1", [uid, b.name]);
      if (old) await db.query('UPDATE account_settings SET renamed_at=$2 WHERE user_id=$1', [uid, now]);
      return view(db, uid);
    });
  }
  async function projectFriends(rows) {
    const ids = [...new Set(rows.flatMap(r => r.data?.users || []))];
    if (!ids.length) return rows;
    const result = await pool.query("SELECT u.id,COALESCE(p.data->>'name',u.display_name) AS name FROM users u LEFT JOIN profiles p ON p.id=u.id WHERE u.id=ANY($1::text[])", [ids]);
    const names = new Map(result.rows.map(r => [r.id, r.name]));
    return rows.map(r => ({ ...r, data: { ...r.data, names: Object.fromEntries((r.data.users || []).map(id => [id, names.get(id) || '???'])) } }));
  }
  return { operation, projectFriends };
}
module.exports = { createAccounts, nickname };
