-- 初始 schema；具名資料表保留現有遊戲文件格式，revision 用於樂觀鎖定。
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  login text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS saves (id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS profiles (id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS names (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS friendships (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS presence (id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS invitations (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS leaderboard_entries (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS leaderboard_summaries (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS reports (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS rooms (id text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, touched_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS friendships_users ON friendships USING gin ((data->'users'));
CREATE INDEX IF NOT EXISTS invitations_recipient ON invitations ((data->>'to'));
CREATE INDEX IF NOT EXISTS leaderboard_members ON leaderboard_entries USING gin ((data->'uids'));
-- 全站外部發證／註冊嘗試配額；重啟與多 API 程序仍共用同一計數。
CREATE TABLE IF NOT EXISTS security_limits (
  id text PRIMARY KEY,
  used integer NOT NULL CHECK (used > 0),
  reset_at timestamptz NOT NULL
);

-- Google 身分只依 sub 對應；不以 Email 自動合併帳號。
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS google_identities (
  google_sub text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  action text NOT NULL CHECK(action IN ('login','link','delete')),
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  session_hash text,
  nonce text NOT NULL,
  verifier text NOT NULL,
  return_to text NOT NULL,
  stage text NOT NULL DEFAULT 'pending' CHECK(stage IN ('pending','processing','verified')),
  google_sub text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_flows_expiry ON oauth_flows(expires_at);
