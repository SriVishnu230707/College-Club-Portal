ALTER TABLE refresh_sessions ADD COLUMN family_id TEXT;
ALTER TABLE refresh_sessions ADD COLUMN rotated_at TEXT;
UPDATE refresh_sessions SET family_id = id WHERE family_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_family_id ON refresh_sessions(family_id);
