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
CREATE TABLE IF NOT EXISTS corps_stats (
    id SERIAL PRIMARY KEY,
    corps_name VARCHAR(255) NOT NULL,
    season INTEGER NOT NULL,
    avg_brass DECIMAL(6,2),
    avg_music_analysis DECIMAL(6,2),
    avg_percussion DECIMAL(6,2),
    avg_color_guard DECIMAL(6,2),
    avg_ge1 DECIMAL(6,2),
    avg_ge2 DECIMAL(6,2),
    avg_visual_proficiency DECIMAL(6,2),
    avg_visual_analysis DECIMAL(6,2),
    total_score DECIMAL(7,2),
    competitions_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(corps_name, season)
);

-- Ensure all corps_stats columns exist on older DB instances
ALTER TABLE corps_stats ALTER COLUMN avg_brass TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN avg_percussion TYPE DECIMAL(6,2);
ALTER TABLE corps_stats ALTER COLUMN total_score TYPE DECIMAL(7,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_music_analysis DECIMAL(6,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_color_guard DECIMAL(6,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_ge1 DECIMAL(6,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_ge2 DECIMAL(6,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_visual_proficiency DECIMAL(6,2);
ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_visual_analysis DECIMAL(6,2);

CREATE INDEX IF NOT EXISTS idx_corps_stats_season ON corps_stats(season);

-- Track one-time schema migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name VARCHAR(255) PRIMARY KEY,
    run_at TIMESTAMP DEFAULT NOW()
);

-- Remove stale corps stats from prior seasons
DELETE FROM corps_stats WHERE season <> 2026;

-- Seed 2026 corps stats — skipped if already present
INSERT INTO corps_stats (corps_name, season, avg_brass, avg_music_analysis, avg_percussion, avg_color_guard, avg_ge1, avg_ge2, avg_visual_proficiency, avg_visual_analysis, total_score, competitions_count)
VALUES
    ('Blue Devils',            2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Santa Clara Vanguard',   2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Bluecoats',              2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Carolina Crown',         2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('The Cavaliers',          2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Boston Crusaders',       2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Phantom Regiment',       2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Blue Stars',             2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Madison Scouts',         2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Blue Knights',           2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Crossmen',               2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Spirit of Atlanta',      2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Pacific Crest',          2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Music City',             2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('The Academy',            2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Troopers',               2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Colts',                  2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Spartans',               2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Genesis',                2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('Seattle Cascades',       2026, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
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
    season INTEGER DEFAULT 2026,
    source_url TEXT,
    last_synced_at TIMESTAMP,
    competition_type VARCHAR(50) DEFAULT 'regular',
    UNIQUE(name, season)
);

-- Ensure all competitions columns exist on older DB instances
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS season INTEGER DEFAULT 2026;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS competition_type VARCHAR(50) DEFAULT 'regular';

CREATE INDEX IF NOT EXISTS idx_competitions_date ON competitions(date DESC);

-- Individual competition scores
CREATE TABLE IF NOT EXISTS competition_scores (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    corps_name VARCHAR(255) NOT NULL,
    brass DECIMAL(5,2),
    music_analysis DECIMAL(5,2),
    percussion DECIMAL(5,2),
    color_guard DECIMAL(5,2),
    ge1 DECIMAL(5,2),
    ge2 DECIMAL(5,2),
    visual_proficiency DECIMAL(5,2),
    visual_analysis DECIMAL(5,2),
    total_score DECIMAL(6,2),
    UNIQUE(competition_id, corps_name)
);

-- Ensure new caption columns exist on older DB instances
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS brass DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS music_analysis DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS percussion DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS color_guard DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS ge1 DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS ge2 DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS visual_proficiency DECIMAL(5,2);
ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS visual_analysis DECIMAL(5,2);

CREATE INDEX IF NOT EXISTS idx_competition_scores_competition ON competition_scores(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_scores_corps ON competition_scores(corps_name);

-- Seed 2026 DCI tour schedule.
-- Uses DO UPDATE so date/location/type stay current on every deploy
-- without deleting admin-entered competition scores.
INSERT INTO competitions (name, date, location, season, competition_type) VALUES
    ('DCI Tour Preview',                      '2026-06-26', 'Muncie, IN',         2026, 'regular'),
    ('Drums Along the Rockies',               '2026-06-27', 'Fort Collins, CO',   2026, 'regular'),
    ('Corps Encore',                          '2026-06-28', 'Ogden, UT',          2026, 'regular'),
    ('Drums Along the Columbia',              '2026-06-29', 'Kennewick, WA',      2026, 'regular'),
    ('Northwest Youth Music Games Seattle',   '2026-06-30', 'Seattle, WA',        2026, 'regular'),
    ('Drums Across Nebraska',                 '2026-07-01', 'Omaha, NE',          2026, 'regular'),
    ('Northwest Youth Music Games Portland',  '2026-07-01', 'Portland, OR',       2026, 'regular'),
    ('Preview of Champions',                   '2026-07-02', 'Nashua, NH',         2026, 'regular'),
    ('MidCal Showcase',                       '2026-07-02', 'Camarillo, CA',      2026, 'regular'),
    ('Rotary Music Festival',                 '2026-07-02', 'Cedarburg, WI',      2026, 'regular'),
    ('Show of Shows',                         '2026-07-03', 'Rockford, IL',       2026, 'regular'),
    ('DCI Capital Classic',                   '2026-07-03', 'Sacramento, CA',     2026, 'regular'),
    ('River City Rhapsody',                   '2026-07-05', 'La Crosse, WI',      2026, 'regular'),
    ('DCI West',                              '2026-07-05', 'Stanford, CA',       2026, 'regular'),
    ('Drums Across the Smokies',              '2026-07-07', 'Sevierville, TN',    2026, 'regular'),
    ('The Kiwanis Thunder of Drums',          '2026-07-07', 'Mankato, MN',        2026, 'regular'),
    ('Drums Across America',                  '2026-07-08', 'Newnan, GA',         2026, 'regular'),
    ('Celebration in Brass',                  '2026-07-08', 'Des Moines, IA',     2026, 'regular'),
    ('Gold Showcase',                         '2026-07-09', 'Santa Clarita, CA',  2026, 'regular'),
    ('DCI Northern Alabama',                  '2026-07-09', 'Muscle Shoals, AL',  2026, 'regular'),
    ('Music on the March',                    '2026-07-10', 'Dubuque, IA',        2026, 'regular'),
    ('Western Corps Connection',              '2026-07-10', 'Walnut, CA',         2026, 'regular'),
    ('Cavalcade of Brass',                    '2026-07-10', 'Lisle, IL',          2026, 'regular'),
    ('The Whitewater Classic',                '2026-07-11', 'Whitewater, WI',     2026, 'regular'),
    ('Drum Corps at the Rose Bowl',           '2026-07-11', 'Pasadena, CA',       2026, 'regular'),
    ('DCI Little Rock',                       '2026-07-11', 'Little Rock, AR',    2026, 'regular'),
    ('Brass Impact',                          '2026-07-13', 'Olathe, KS',         2026, 'regular'),
    ('Drums Across the Desert',               '2026-07-13', 'Mesa, AZ',           2026, 'regular'),
    ('DCI Broken Arrow',                      '2026-07-14', 'Broken Arrow, OK',   2026, 'regular'),
    ('DCI Hutchinson',                        '2026-07-14', 'Hutchinson, KS',     2026, 'regular'),
    ('DCI New Mexico',                        '2026-07-14', 'Albuquerque, NM',    2026, 'regular'),
    ('DCI Central Texas',                     '2026-07-16', 'Killeen, TX',        2026, 'regular'),
    ('DCI Denton',                            '2026-07-16', 'Denton, TX',         2026, 'regular'),
    ('DCI Southwestern Championship',         '2026-07-18', 'San Antonio, TX',    2026, 'championship'),
    ('DCI Southeastern Championship',         '2026-07-25', 'Atlanta, GA',        2026, 'championship'),
    ('DCI Midwestern Championship',           '2026-07-25', 'DeKalb, IL',         2026, 'championship'),
    ('DCI Eastern Classic Day 1',             '2026-07-31', 'Allentown, PA',      2026, 'championship'),
    ('DCI Eastern Classic Day 2',             '2026-08-01', 'Allentown, PA',      2026, 'championship'),
    ('DCI World Championship Prelims',        '2026-08-06', 'Indianapolis, IN',   2026, 'championship'),
    ('DCI World Championship Semifinals',     '2026-08-07', 'Indianapolis, IN',   2026, 'championship'),
    ('DCI World Championship Finals',         '2026-08-08', 'Indianapolis, IN',   2026, 'championship')
ON CONFLICT DO NOTHING;

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
