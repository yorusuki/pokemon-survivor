'use strict';
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const TABLES = ['users', 'sessions', 'saves', 'profiles', 'names', 'friendships', 'presence', 'invitations', 'runs', 'leaderboard_entries', 'leaderboard_summaries', 'reports', 'rooms', 'security_limits', 'google_identities', 'oauth_flows'];

async function grantRuntime(db, password) {
  if (typeof password !== 'string' || password.length < 32 || password.length > 256 || /[\x00-\x1f]/.test(password)) throw new Error('APP_DATABASE_PASSWORD 必須為 32～256 個不含控制字元的字元');
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pokesurvivor_app') THEN CREATE ROLE pokesurvivor_app NOLOGIN; END IF; END $$");
  const memberships = await db.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='pokesurvivor_app')");
  if (memberships.rows.length) throw new Error('pokesurvivor_app 有額外角色成員資格，請先人工檢查');
  const ownership = await db.query("SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname='pokesurvivor_app') AND n.nspname='public') AS owns_objects");
  if (ownership.rows[0].owns_objects) throw new Error('pokesurvivor_app 不可擁有 public 物件，請先人工移交 owner');
  // PostgreSQL format(%L) 正確處理密碼 literal；不得拼接秘密或將 SQL 寫入 log。
  const alter = await db.query("SELECT format('ALTER ROLE pokesurvivor_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD %L', $1::text) AS sql", [password]);
  await db.query(alter.rows[0].sql);
  await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await db.query('REVOKE ALL ON SCHEMA public FROM pokesurvivor_app');
  await db.query('GRANT USAGE ON SCHEMA public TO pokesurvivor_app');
  const connect = await db.query("SELECT has_database_privilege('pokesurvivor_app',current_database(),'CONNECT') AS allowed");
  if (!connect.rows[0].allowed) {
    const database = await db.query("SELECT format('GRANT CONNECT ON DATABASE %I TO pokesurvivor_app', current_database()) AS sql");
    await db.query(database.rows[0].sql);
  }
  for (const table of TABLES) {
    await db.query(`REVOKE ALL ON TABLE public.${table} FROM pokesurvivor_app`);
    await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.${table} TO pokesurvivor_app`);
  }
}
async function main() {
  if (process.env.APP_DATABASE_PASSWORD === process.env.PGPASSWORD) throw new Error('初始化與 runtime 密碼必須不同');
  const pool = new Pool({ max: 1, statement_timeout: 30000 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(148062,2)');
    await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await grantRuntime(db, process.env.APP_DATABASE_PASSWORD);
    await db.query('COMMIT');
    console.log('database_bootstrap_completed');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('database_bootstrap_failed'); process.exitCode = 1; });
module.exports = { grantRuntime };
