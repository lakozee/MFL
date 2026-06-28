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

        // One-time migration: remove test competition and zero out corps stats
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'remove_test_competition_2026' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                await client.query(`
                    DELETE FROM competition_scores
                    WHERE competition_id IN (
                        SELECT id FROM competitions WHERE name = 'TEST - Sample Show' AND season = 2026
                    )
                `);
                await client.query(`DELETE FROM competitions WHERE name = 'TEST - Sample Show' AND season = 2026`);
                await client.query(`
                    UPDATE corps_stats SET
                        avg_brass = 0, avg_music_analysis = 0, avg_percussion = 0,
                        avg_color_guard = 0, avg_ge1 = 0, avg_ge2 = 0,
                        avg_visual_proficiency = 0, avg_visual_analysis = 0,
                        total_score = 0, competitions_count = 0
                    WHERE season = 2026
                `);
                await client.query(
                    "INSERT INTO schema_migrations (migration_name) VALUES ('remove_test_competition_2026')"
                );
                console.log('[init-db] Migration: removed test competition and zeroed corps stats');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (remove test competition):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Drums Along the Rockies (2026) caption scores.
        // This is the first qualifying show for these corps. After inserting the
        // scores we re-run the same corps_stats recalculation used by the admin
        // panel (server/routes/admin.js → recalculateCorpsAverages) so the corps
        // totals reflect these scores immediately on deploy. Guarded so it runs once.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'datr_rockies_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Drums Along the Rockies' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const rockiesScores = [
                        ['Blue Devils',      14.8, 15.2, 14.7, 15.4, 15.0, 15.2, 15.6, 15.2],
                        ['Phantom Regiment', 14.5, 14.6, 14.3, 14.9, 14.3, 14.6, 14.6, 14.6],
                        ['Troopers',         14.0, 13.7, 13.9, 13.0, 13.4, 13.5, 14.2, 13.1],
                        ['Blue Knights',     13.5, 13.8, 13.3, 13.6, 13.8, 13.1, 13.9, 13.2],
                        ['Genesis',          12.2, 12.9, 11.7, 11.9, 11.5, 12.7, 12.4, 11.2],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of rockiesScores) {
                        const total = Math.round((brass + ma + perc + cg + ge1 + ge2 + vp + va) * 100) / 100;
                        await client.query(
                            `INSERT INTO competition_scores
                               (competition_id, corps_name, brass, music_analysis, percussion, color_guard,
                                ge1, ge2, visual_proficiency, visual_analysis, total_score)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                             ON CONFLICT (competition_id, corps_name) DO NOTHING`,
                            [competitionId, name, brass, ma, perc, cg, ge1, ge2, vp, va, total]
                        );
                    }
                    // Recalculate corps_stats from qualifying shows only — verbatim copy of
                    // recalculateCorpsAverages() in server/routes/admin.js. Keep in sync if that changes.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            c.competition_type,
                            c.name AS competition_name,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        corps_with_regional_7th AS (
                          SELECT corps_name FROM ranked
                          WHERE comp_seq = 7
                            AND (
                              LOWER(competition_name) LIKE '%southwestern%'
                           OR LOWER(competition_name) LIKE '%san antonio%'
                           OR LOWER(competition_name) LIKE '%southeastern%'
                           OR LOWER(competition_name) LIKE '%midwestern%'
                           OR LOWER(competition_name) LIKE '%eastern classic%'
                           OR LOWER(competition_name) LIKE '%allentown%'
                            )
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR comp_seq IN (1, 3, 5)
                             OR (comp_seq = 7 AND corps_name NOT IN (SELECT corps_name FROM corps_with_regional_7th))
                             OR (comp_seq = 6 AND corps_name IN (SELECT corps_name FROM corps_with_regional_7th))
                        ),
                        totals AS (
                          SELECT
                            corps_name,
                            ROUND(SUM(brass)::numeric, 2)              AS sum_brass,
                            ROUND(SUM(music_analysis)::numeric, 2)     AS sum_music_analysis,
                            ROUND(SUM(percussion)::numeric, 2)         AS sum_percussion,
                            ROUND(SUM(color_guard)::numeric, 2)        AS sum_color_guard,
                            ROUND(SUM(ge1)::numeric, 2)                AS sum_ge1,
                            ROUND(SUM(ge2)::numeric, 2)                AS sum_ge2,
                            ROUND(SUM(visual_proficiency)::numeric, 2) AS sum_visual_proficiency,
                            ROUND(SUM(visual_analysis)::numeric, 2)    AS sum_visual_analysis,
                            COUNT(*)                                   AS qualifying_count
                          FROM qualifying
                          GROUP BY corps_name
                        )
                        UPDATE corps_stats cs_outer
                        SET
                          avg_brass              = t.sum_brass,
                          avg_music_analysis     = t.sum_music_analysis,
                          avg_percussion         = t.sum_percussion,
                          avg_color_guard        = t.sum_color_guard,
                          avg_ge1                = t.sum_ge1,
                          avg_ge2                = t.sum_ge2,
                          avg_visual_proficiency = t.sum_visual_proficiency,
                          avg_visual_analysis    = t.sum_visual_analysis,
                          total_score            = t.sum_brass + t.sum_music_analysis + t.sum_percussion + t.sum_color_guard
                                                 + t.sum_ge1 + t.sum_ge2 + t.sum_visual_proficiency + t.sum_visual_analysis,
                          competitions_count     = t.qualifying_count,
                          updated_at             = NOW()
                        FROM totals t
                        WHERE cs_outer.corps_name = t.corps_name AND cs_outer.season = 2026
                    `);
                    await client.query(
                        "INSERT INTO schema_migrations (migration_name) VALUES ('datr_rockies_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Drums Along the Rockies 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Drums Along the Rockies 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (rockies scores):', err.message.split('\n')[0]);
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
