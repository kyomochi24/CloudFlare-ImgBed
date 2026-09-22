-- Run once in the same D1 database used by Studio (img_d1).
CREATE TABLE IF NOT EXISTS studio_candy_usage (
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  day_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day_key)
);
CREATE TABLE IF NOT EXISTS studio_candy_exports (
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  project_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, project_id)
);
