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
  yt_url      TEXT DEFAULT '',
  ig_url      TEXT DEFAULT '',
  tk_url      TEXT DEFAULT '',
  dc_id       TEXT DEFAULT '',
  tw_url      TEXT DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  riot_name   TEXT DEFAULT '',
  riot_tag    TEXT DEFAULT '',
  kd_ratio    REAL DEFAULT 0.0,
  win_rate    REAL DEFAULT 0.0,
  hs_rate     REAL DEFAULT 0.0,
  top_agents  TEXT DEFAULT '', -- JSON string: ["Jett", "Omen", "Sage"]
  play_style  TEXT DEFAULT 'Competitive', -- 'Casual', 'Competitive', 'Scrim'
  rank_numeric INTEGER DEFAULT 0, -- 1-25 (Demir-Radiant)
  last_scraped_at DATETIME,
  is_looking_for_team INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS team_finder (
  post_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  role        TEXT NOT NULL,
  players_needed INTEGER DEFAULT 1,
  lobby_code  TEXT,
  game_mode   TEXT DEFAULT 'Dereceli',
  min_rank    TEXT DEFAULT 'Demir',
  max_rank    TEXT DEFAULT 'Radiant',
  age_range   TEXT DEFAULT 'Tümü',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id)
);

CREATE INDEX IF NOT EXISTS idx_slug ON profiles(slug);
