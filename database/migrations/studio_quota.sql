CREATE TABLE IF NOT EXISTS studio_dondon_users (
  user_id TEXT PRIMARY KEY REFERENCES studio_users(id),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS studio_quota_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  month_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_quota_reservations_user ON studio_quota_reservations(user_id, month_key);

UPDATE studio_users SET stored_bytes=COALESCE((SELECT sum(size_bytes) FROM studio_files WHERE user_id=studio_users.id), 0),
  month_uploaded_bytes=max(
    CASE WHEN month_key=strftime('%Y-%m','now','+8 hours') THEN month_uploaded_bytes ELSE 0 END,
    COALESCE((SELECT sum(size_bytes) FROM studio_files WHERE user_id=studio_users.id
      AND strftime('%Y-%m',created_at,'+8 hours')=strftime('%Y-%m','now','+8 hours')), 0)
  ), month_key=strftime('%Y-%m','now','+8 hours');

CREATE TRIGGER IF NOT EXISTS studio_files_reservation_valid BEFORE INSERT ON studio_files
WHEN EXISTS(SELECT 1 FROM studio_quota_reservations WHERE id=NEW.id
  AND (month_key<>strftime('%Y-%m',NEW.created_at,'+8 hours') OR expires_at<=unixepoch()*1000))
BEGIN
  SELECT RAISE(ABORT, 'Upload reservation expired; retry upload');
END;

CREATE TRIGGER IF NOT EXISTS studio_files_quota_insert AFTER INSERT ON studio_files
BEGIN
  UPDATE studio_users SET stored_bytes=stored_bytes+NEW.size_bytes,
    month_uploaded_bytes=CASE
      WHEN month_key=strftime('%Y-%m',NEW.created_at,'+8 hours') THEN month_uploaded_bytes+NEW.size_bytes
      WHEN month_key<strftime('%Y-%m',NEW.created_at,'+8 hours') THEN NEW.size_bytes
      ELSE month_uploaded_bytes END,
    month_key=max(month_key,strftime('%Y-%m',NEW.created_at,'+8 hours'))
    WHERE id=NEW.user_id;
  DELETE FROM studio_quota_reservations WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS studio_files_quota_delete AFTER DELETE ON studio_files
BEGIN
  UPDATE studio_users SET stored_bytes=max(0,stored_bytes-OLD.size_bytes) WHERE id=OLD.user_id;
END;
