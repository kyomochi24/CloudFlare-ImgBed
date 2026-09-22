-- 在 Cloudflare D1 控制台执行一次，开启丘丘智能抠图每日次数。
CREATE TABLE IF NOT EXISTS studio_cutout_usage (
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  day_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  PRIMARY KEY(user_id, day_key)
);
