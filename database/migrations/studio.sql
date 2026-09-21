-- Run once in the D1 console. This does not change existing ImgBed tables.
CREATE TABLE IF NOT EXISTS studio_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  password_hash TEXT,
  discord_id TEXT UNIQUE,
  discord_name TEXT,
  account_type TEXT NOT NULL CHECK(account_type IN ('discord','local')),
  tier TEXT NOT NULL DEFAULT 'pichu' CHECK(tier IN ('pichu','pikachu')),
  disabled INTEGER NOT NULL DEFAULT 0,
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  month_key TEXT NOT NULL DEFAULT '',
  month_uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_sessions_user ON studio_sessions(user_id);
CREATE TABLE IF NOT EXISTS studio_albums (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_studio_albums_user ON studio_albums(user_id);
CREATE TABLE IF NOT EXISTS studio_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  album_id TEXT NOT NULL REFERENCES studio_albums(id),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_studio_files_album ON studio_files(user_id, album_id, created_at);
CREATE TABLE IF NOT EXISTS studio_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  discord_id TEXT NOT NULL,
  work_title TEXT NOT NULL,
  work_url TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_studio_applications_status ON studio_applications(status, created_at);
CREATE TABLE IF NOT EXISTS studio_login_attempts (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
