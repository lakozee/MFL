-- Fantasy DCI Database Schema
-- Idempotent: safe to run multiple times (no DROP TABLE statements)

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    profile_picture_url TEXT DEFAULT '/default-avatar.png',
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    username VARCHAR(50) UNIQUE,
    is_admin BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Leagues table
CREATE TABLE IF NOT EXISTS leagues (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    max_players INTEGER DEFAULT 12 CHECK (max_players >= 4 AND max_players <= 12),
    min_players INTEGER DEFAULT 4 CHECK (min_players >= 4 AND min_players <= 12),
    draft_started BOOLEAN DEFAULT FALSE,
    draft_completed BOOLEAN DEFAULT FALSE,
    draft_lobby_open BOOLEAN DEFAULT FALSE,
    turn_timer_seconds INTEGER DEFAULT NULL,
    current_draft_turn INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leagues_creator ON leagues(creator_id);

-- League members
CREATE TABLE IF NOT EXISTS league_members (
    league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    team_name VARCHAR(255) NOT NULL,
    draft_position INTEGER,
    joined_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id);

-- Draft picks (stores which user picked which caption)
CREATE TABLE IF NOT EXISTS draft_picks (
    id SERIAL PRIMARY KEY,
    league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    caption_id VARCHAR(50) NOT NULL,
    section_type VARCHAR(50) NOT NULL,
    pick_number INTEGER NOT NULL,
    drafted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(league_id, caption_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_picks_league ON draft_picks(league_id);

-- Corps statistics
-- NOTE: avg_* columns store sums (not averages) of qualifying show scores
-- DECIMAL(6,2) supports values up to 9999.99, sufficient for multi-show sums
CREATE TABLE IF NOT EXISTS corps_stats (
    id SERIAL PRIMARY KEY,
    corps_name VARCHAR(255) NOT NULL,
    season INTEGER NOT NULL,
    avg_brass DECIMAL(6,2),
    avg_percussion DECIMAL(6,2),
    avg_guard DECIMAL(6,2),
    avg_ge DECIMAL(6,2),
    avg_visual DECIMAL(6,2),
    total_score DECIMAL(7,2),
    competitions_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(corps_name, season)
);

-- Widen existing columns in case DB was created with old schema (DECIMAL(4,2) or (5,2))
ALTER TABLE corps_stats ALTER COLUMN avg_brass TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN avg_percussion TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN avg_guard TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN avg_ge TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN avg_visual TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN total_score TYPE DECIMAL(7,2);

CREATE INDEX IF NOT EXISTS idx_corps_stats_season ON corps_stats(season);

-- Seed sample corps stats — skipped if already present
INSERT INTO corps_stats (corps_name, season, avg_brass, avg_percussion, avg_guard, avg_ge, avg_visual, total_score, competitions_count)
VALUES
    ('Blue Devils',            2025, 19.8, 19.7, 19.6, 19.9, 19.7, 98.7, 5),
    ('Santa Clara Vanguard',   2025, 19.6, 19.8, 19.5, 19.7, 19.6, 98.2, 5),
    ('Bluecoats',              2025, 19.5, 19.6, 19.8, 19.6, 19.5, 98.0, 5),
    ('Carolina Crown',         2025, 19.7, 19.5, 19.4, 19.6, 19.7, 97.9, 5),
    ('The Cavaliers',          2025, 19.4, 19.4, 19.3, 19.5, 19.6, 97.2, 5),
    ('Boston Crusaders',       2025, 19.3, 19.7, 19.2, 19.4, 19.3, 96.9, 5)
ON CONFLICT (corps_name, season) DO NOTHING;

-- League invite tokens
CREATE TABLE IF NOT EXISTS league_invites (
    id SERIAL PRIMARY KEY,
    league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days',
    used_count INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_league_invites_token ON league_invites(token);
CREATE INDEX IF NOT EXISTS idx_league_invites_league ON league_invites(league_id);

-- Competitions tracking
CREATE TABLE IF NOT EXISTS competitions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    location VARCHAR(255),
    season INTEGER DEFAULT 2025,
    source_url TEXT,
    last_synced_at TIMESTAMP,
    competition_type VARCHAR(50) DEFAULT 'regular',
    UNIQUE(name, season)
);

-- Add competition_type to existing DBs that didn't have it
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS competition_type VARCHAR(50) DEFAULT 'regular';

CREATE INDEX IF NOT EXISTS idx_competitions_date ON competitions(date DESC);

-- Individual competition scores
CREATE TABLE IF NOT EXISTS competition_scores (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    corps_name VARCHAR(255) NOT NULL,
    brass DECIMAL(4,2),
    percussion DECIMAL(4,2),
    guard DECIMAL(4,2),
    ge DECIMAL(4,2),
    visual DECIMAL(4,2),
    total_score DECIMAL(5,2),
    UNIQUE(competition_id, corps_name)
);

CREATE INDEX IF NOT EXISTS idx_competition_scores_competition ON competition_scores(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_scores_corps ON competition_scores(corps_name);

-- Draft sessions for real-time draft lobby
CREATE TABLE IF NOT EXISTS draft_sessions (
    id SERIAL PRIMARY KEY,
    league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    is_connected BOOLEAN DEFAULT FALSE,
    is_ready BOOLEAN DEFAULT FALSE,
    last_heartbeat TIMESTAMP DEFAULT NOW(),
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_league ON draft_sessions(league_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_connected ON draft_sessions(is_connected);
