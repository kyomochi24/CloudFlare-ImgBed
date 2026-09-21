CREATE TABLE IF NOT EXISTS studio_super_users (
  user_id TEXT PRIMARY KEY REFERENCES studio_users(id),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS studio_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  album_id TEXT NOT NULL REFERENCES studio_albums(id),
  object_key TEXT NOT NULL UNIQUE,
  r2_upload_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_studio_uploads_user ON studio_uploads(user_id);
CREATE TABLE IF NOT EXISTS studio_upload_parts (
  upload_id TEXT NOT NULL REFERENCES studio_uploads(id),
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY(upload_id, part_number)
);
