CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE club_memberships (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX idx_club_memberships_user ON club_memberships(user_id);

CREATE TABLE club_join_requests (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  id_card_photo BLOB,
  id_card_mime TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_club_join_requests_pending ON club_join_requests(club_id, user_id) WHERE status = 'pending';
CREATE INDEX idx_club_join_requests_club_status ON club_join_requests(club_id, status, created_at);
