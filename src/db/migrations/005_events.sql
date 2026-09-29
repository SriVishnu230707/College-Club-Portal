CREATE TABLE events (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  audience TEXT NOT NULL DEFAULT 'club_members' CHECK (audience IN ('club_members', 'all_members')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_events_club ON events(club_id);
CREATE INDEX idx_events_status_start ON events(status, starts_at);

CREATE TABLE event_registrations (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_registrations_user ON event_registrations(user_id);
