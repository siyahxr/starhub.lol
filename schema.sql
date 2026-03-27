-- StarHUB Profil Tablosu
-- Bu SQL'i Cloudflare D1 panelinden çalıştır:
-- Dashboard > D1 > starhub_db > Console > Paste & Run

CREATE TABLE IF NOT EXISTS profiles (
  user_id     TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  slug        TEXT UNIQUE,
  avatar_url  TEXT DEFAULT '',
  banner_url  TEXT DEFAULT '',
  rank_name   TEXT DEFAULT 'Unranked',
  rank_rr     INTEGER DEFAULT 0,
  bio         TEXT DEFAULT '',
  is_public   INTEGER DEFAULT 1,
  sync_active INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slug ON profiles(slug);
