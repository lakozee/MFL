/**
 * Database initializer — runs before the server starts.
 * Executes database/schema.sql against the DATABASE_URL.
 * Safe to run multiple times (all statements are idempotent).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDb() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('[init-db] ERROR: DATABASE_URL is not set. Cannot initialize database.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 10000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('[init-db] Connecting to database...');
        const client = await pool.connect();
        console.log('[init-db] Connected. Running schema...');

        const schemaPath = path.join(__dirname, 'database', 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');

        // Execute each statement individually so one failure cannot block
        // the rest (e.g. a redundant ALTER TABLE won't abort the seed INSERT).
        const statements = sql
            .replace(/--[^\n]*/g, '')   // strip line comments
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        let warnings = 0;
        for (const stmt of statements) {
            try {
                await client.query(stmt);
            } catch (err) {
                console.warn(`[init-db] warning: ${err.message.split('\n')[0]}`);
                warnings++;
            }
        }

        // One-time migration: clear all leagues when moving to v2 caption system
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'clear_leagues_v2_captions' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                await client.query('DELETE FROM draft_picks');
                await client.query('DELETE FROM draft_sessions');
                await client.query('DELETE FROM league_members');
                await client.query('DELETE FROM leagues');
                await client.query(
                    "INSERT INTO schema_migrations (migration_name) VALUES ('clear_leagues_v2_captions')"
                );
                console.log('[init-db] Migration: cleared all leagues for v2 caption system');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning:', err.message.split('\n')[0]);
        }

        // One-time migration: zero out all corps stats for clean launch
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'zero_corps_stats_launch' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                await client.query(`
                    UPDATE corps_stats SET
                        avg_brass = 0, avg_music_analysis = 0, avg_percussion = 0,
                        avg_color_guard = 0, avg_ge1 = 0, avg_ge2 = 0,
                        avg_visual_proficiency = 0, avg_visual_analysis = 0,
                        total_score = 0, competitions_count = 0
                    WHERE season = 2026
                `);
                await client.query('DELETE FROM competition_scores');
                await client.query(
                    "INSERT INTO schema_migrations (migration_name) VALUES ('zero_corps_stats_launch')"
                );
                console.log('[init-db] Migration: zeroed all corps stats for launch');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning:', err.message.split('\n')[0]);
        }

        // One-time migration: seed test competition with randomised scores
        // To remove: delete this block + use Admin Panel to delete "TEST - Sample Show"
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'seed_test_competition_2026' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                // Delete any prior test competition so we get a clean insert
                await client.query(`DELETE FROM competitions WHERE name = 'TEST - Sample Show' AND season = 2026`);
                const compRes = await client.query(`
                    INSERT INTO competitions (name, date, location, season, competition_type)
                    VALUES ('TEST - Sample Show', '2026-06-26', 'Test City, XX', 2026, 'regular')
                    RETURNING id
                `);
                const cid = compRes.rows[0].id;
                const scores = [
                    ['Blue Devils',          10.78, 10.37, 10.57, 10.33,  9.80, 10.08,  9.91, 10.19],
                    ['Santa Clara Vanguard', 10.11,  9.78, 10.03, 10.51, 10.57, 10.07, 10.45, 10.35],
                    ['Bluecoats',            10.07, 10.11,  9.63,  9.44, 10.04,  9.92, 10.36, 10.38],
                    ['Carolina Crown',        9.36,  9.87,  9.39,  9.63,  9.20,  9.63,  9.74, 10.00],
                    ['The Cavaliers',         9.37,  9.50,  9.21,  9.19,  9.37,  9.43,  8.94,  9.51],
                    ['Boston Crusaders',      8.96,  9.09,  9.00,  9.69,  8.88,  9.02,  9.16,  8.75],
                    ['Phantom Regiment',      8.93,  9.44,  8.61,  9.09,  9.27,  8.82,  8.90,  8.82],
                    ['Blue Stars',            9.29,  9.14,  8.35,  9.19,  8.43,  9.13,  9.20,  8.52],
                    ['Madison Scouts',        8.36,  8.24,  8.99,  8.37,  8.20,  8.77,  8.14,  8.31],
                    ['Blue Knights',          8.74,  8.71,  8.59,  8.50,  8.41,  8.78,  8.06,  8.02],
                    ['Crossmen',              7.98,  7.81,  8.08,  8.24,  8.30,  7.73,  8.04,  8.28],
                    ['Spirit of Atlanta',     8.21,  8.40,  7.73,  8.10,  8.49,  8.40,  8.14,  8.30],
                    ['Pacific Crest',         7.57,  7.73,  7.63,  7.42,  7.45,  7.87,  8.09,  7.39],
                    ['Music City',            7.61,  7.75,  7.95,  7.47,  7.77,  7.51,  7.80,  7.89],
                    ['The Academy',           7.76,  7.57,  7.55,  6.87,  7.76,  7.50,  6.95,  6.83],
                    ['Troopers',              7.15,  6.80,  6.85,  6.76,  6.80,  7.49,  7.37,  6.94],
                    ['Colts',                 7.36,  7.29,  6.67,  7.02,  7.37,  6.72,  6.61,  7.07],
                    ['Spartans',              6.72,  6.49,  6.45,  6.94,  6.73,  6.53,  6.76,  6.57],
                ];
                for (const [name, b, ma, p, cg, g1, g2, vp, va] of scores) {
                    const total = Math.round((b+ma+p+cg+g1+g2+vp+va)*100)/100;
                    await client.query(`
                        INSERT INTO competition_scores
                          (competition_id, corps_name, brass, music_analysis, percussion, color_guard,
                           ge1, ge2, visual_proficiency, visual_analysis, total_score)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                        ON CONFLICT (competition_id, corps_name) DO NOTHING
                    `, [cid, name, b, ma, p, cg, g1, g2, vp, va, total]);
                }
                // Recalculate corps_stats from the new competition scores
                await client.query(`
                    WITH ranked AS (
                      SELECT cs.corps_name,
                        cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                        cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                        c.competition_type,
                        ROW_NUMBER() OVER (PARTITION BY cs.corps_name ORDER BY c.date ASC) AS comp_seq
                      FROM competition_scores cs
                      JOIN competitions c ON cs.competition_id = c.id
                      WHERE c.season = 2026
                    ),
                    qualifying AS (
                      SELECT * FROM ranked
                      WHERE competition_type = 'championship' OR comp_seq IN (1, 3, 5, 7)
                    ),
                    totals AS (
                      SELECT corps_name,
                        ROUND(SUM(brass)::numeric,2)              AS sb,
                        ROUND(SUM(music_analysis)::numeric,2)     AS sma,
                        ROUND(SUM(percussion)::numeric,2)         AS sp,
                        ROUND(SUM(color_guard)::numeric,2)        AS scg,
                        ROUND(SUM(ge1)::numeric,2)                AS sg1,
                        ROUND(SUM(ge2)::numeric,2)                AS sg2,
                        ROUND(SUM(visual_proficiency)::numeric,2) AS svp,
                        ROUND(SUM(visual_analysis)::numeric,2)    AS sva,
                        COUNT(*) AS qc
                      FROM qualifying GROUP BY corps_name
                    )
                    UPDATE corps_stats x SET
                      avg_brass=t.sb, avg_music_analysis=t.sma, avg_percussion=t.sp,
                      avg_color_guard=t.scg, avg_ge1=t.sg1, avg_ge2=t.sg2,
                      avg_visual_proficiency=t.svp, avg_visual_analysis=t.sva,
                      total_score=t.sb+t.sma+t.sp+t.scg+t.sg1+t.sg2+t.svp+t.sva,
                      competitions_count=t.qc, updated_at=NOW()
                    FROM totals t WHERE x.corps_name=t.corps_name AND x.season=2026
                `);
                await client.query(
                    "INSERT INTO schema_migrations (migration_name) VALUES ('seed_test_competition_2026')"
                );
                console.log('[init-db] Migration: seeded test competition with scores for all 18 corps');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (test competition):', err.message.split('\n')[0]);
        }

        client.release();

        console.log(`[init-db] Schema applied — ${warnings} warning(s).`);
    } catch (err) {
        console.error('[init-db] ERROR: Failed to initialize database:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDb();
