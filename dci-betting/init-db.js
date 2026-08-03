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

        // One-time migration: seed Corps Encore (2026-06-28) caption scores.
        // This is the 2nd competition for every corps listed, so none of these
        // scores qualify (qualifying = 1st, 3rd, 5th, 7th, or championship).
        // We still re-run the corps_stats recalc to keep state consistent.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'corps_encore_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Corps Encore' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const corpsEncoreScores = [
                        ['Blue Devils',   15.3, 15.4, 15.6, 15.6, 15.5, 15.3, 15.4, 15.6],
                        ['Troopers',      13.8, 13.6, 14.9, 14.1, 13.5, 13.9, 13.7, 13.9],
                        ['Blue Knights',  13.6, 13.5, 14.6, 14.2, 13.8, 13.5, 13.8, 13.7],
                        ['Genesis',       12.8, 12.2, 13.7, 11.9, 12.2, 12.9, 11.9, 11.6],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of corpsEncoreScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('corps_encore_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Corps Encore 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Corps Encore 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (corps encore scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Northwest Youth Music Games Seattle (2026) scores.
        // This is the first (qualifying) show for both Santa Clara Vanguard and
        // Seattle Cascades, so these scores count toward player totals. We re-run the
        // same corps_stats recalc as the admin panel so totals update on deploy.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'nwymg_seattle_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Northwest Youth Music Games Seattle' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const seattleScores = [
                        ['Santa Clara Vanguard', 15.5, 16.0, 16.4, 15.0, 15.2, 15.1, 15.4, 16.2],
                        ['Seattle Cascades',     12.1, 12.8, 13.0, 12.3, 12.1, 12.5, 12.5, 13.4],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of seattleScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('nwymg_seattle_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Northwest Youth Music Games Seattle 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Northwest Youth Music Games Seattle 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (seattle scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Northwest Youth Music Games Portland (2026-07-01) scores.
        // This is the 2nd competition of the season for both corps (they also
        // competed at NW Youth Music Games Seattle on 2026-06-30 = seq 1), so
        // these scores are non-qualifying (qualifying = 1/3/5/7 or championship).
        // We still re-run the corps_stats recalc for consistency.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'nwymg_portland_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Northwest Youth Music Games Portland' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const portlandScores = [
                        ['Santa Clara Vanguard', 15.7, 16.4, 16.4, 15.3, 15.6, 15.6, 15.7, 16.3],
                        ['Seattle Cascades',     12.3, 12.9, 13.0, 12.6, 12.2, 12.5, 12.4, 13.4],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of portlandScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('nwymg_portland_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Northwest Youth Music Games Portland 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Northwest Youth Music Games Portland 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (portland scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Drums Across Nebraska (2026-07-01) scores.
        // Qualifying breakdown for the corps competing here:
        //   Phantom Regiment — seq 2 (Rockies is seq 1)               → not qualifying
        //   Troopers         — seq 3 (Rockies, Corps Encore)          → qualifying
        //   Blue Knights     — seq 3 (Rockies, Corps Encore)          → qualifying
        //   Colts            — seq 1 (no prior shows)                 → qualifying
        //   Genesis          — seq 3 (Rockies, Corps Encore)          → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'drums_across_nebraska_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Drums Across Nebraska' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const nebraskaScores = [
                        ['Phantom Regiment', 15.3, 15.0, 15.7, 15.6, 15.3, 14.9, 15.4, 15.4],
                        ['Troopers',         14.4, 14.5, 15.2, 14.8, 13.8, 14.2, 14.5, 14.3],
                        ['Blue Knights',     14.1, 14.2, 14.6, 14.6, 14.0, 14.0, 13.8, 14.4],
                        ['Colts',            13.7, 13.8, 14.7, 15.0, 13.5, 13.5, 14.2, 14.0],
                        ['Genesis',          13.1, 13.0, 12.5, 12.4, 12.8, 12.8, 11.8, 12.4],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of nebraskaScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('drums_across_nebraska_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Drums Across Nebraska 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Drums Across Nebraska 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (nebraska scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Capital Classic (2026-07-03) scores.
        // Qualifying breakdown for the corps competing here:
        //   Bluecoats            — seq 1 (no prior shows)              → qualifying
        //   Santa Clara Vanguard — seq 3 (NW Seattle, NW Portland)     → qualifying
        //   The Academy          — seq 1 (no prior shows)              → qualifying
        //   Seattle Cascades     — seq 3 (NW Seattle, NW Portland)     → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_capital_classic_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Capital Classic' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const capClassicScores = [
                        ['Bluecoats',            16.9, 16.8, 16.6, 16.9, 15.8, 16.2, 16.4, 16.8],
                        ['Santa Clara Vanguard', 16.2, 16.5, 16.8, 16.2, 15.4, 15.9, 16.0, 16.3],
                        ['The Academy',          13.6, 14.2, 14.2, 12.5, 13.3, 13.6, 14.4, 13.9],
                        ['Seattle Cascades',     12.5, 13.3, 13.5, 11.5, 12.2, 12.6, 12.6, 13.5],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of capClassicScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_capital_classic_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Capital Classic 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Capital Classic 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (capital classic scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI West (2026-07-05) scores.
        // Qualifying breakdown for the corps competing here:
        //   Bluecoats            — seq 2 (Cap Classic)                      → not qualifying
        //   Blue Devils          — seq 3 (Rockies, Corps Encore)            → qualifying
        //   Santa Clara Vanguard — seq 4 (NW Seattle, NW Portland, Cap Cl.) → not qualifying
        //   The Academy          — seq 2 (Cap Classic)                      → not qualifying
        //   Seattle Cascades     — seq 4 (NW Seattle, NW Portland, Cap Cl.) → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_west_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI West' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const dciWestScores = [
                        ['Bluecoats',            16.8, 17.1, 16.7, 17.1, 16.7, 16.7, 16.7, 16.7],
                        ['Blue Devils',          16.5, 16.7, 16.4, 16.4, 16.4, 16.3, 16.3, 16.4],
                        ['Santa Clara Vanguard', 16.4, 16.5, 16.3, 15.9, 16.3, 16.1, 16.4, 16.0],
                        ['The Academy',          13.9, 14.4, 14.3, 12.8, 13.8, 13.7, 14.0, 14.1],
                        ['Seattle Cascades',     12.7, 13.7, 13.1, 11.4, 12.8, 12.9, 13.0, 13.1],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of dciWestScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_west_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI West 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI West 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci west scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed River City Rhapsody (2026-07-05) scores.
        // Qualifying breakdown for the corps competing here:
        //   Phantom Regiment — seq 3 (Rockies, Nebraska)                       → qualifying
        //   Blue Stars       — seq 1 (no prior shows)                          → qualifying
        //   The Cavaliers    — seq 1 (no prior shows)                          → qualifying
        //   Troopers         — seq 4 (Rockies, Corps Encore, Nebraska)         → not qualifying
        //   Colts            — seq 2 (Nebraska)                                → not qualifying
        //   Madison Scouts   — seq 1 (no prior shows)                          → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'river_city_rhapsody_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'River City Rhapsody' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const riverCityScores = [
                        ['Phantom Regiment', 15.7, 15.7, 16.0, 15.7, 16.3, 15.5, 15.7, 16.0],
                        ['Blue Stars',       14.9, 15.1, 15.5, 15.3, 16.2, 15.2, 15.8, 15.4],
                        ['The Cavaliers',    14.3, 14.8, 15.9, 15.2, 14.9, 14.8, 15.6, 15.3],
                        ['Troopers',         14.7, 15.3, 15.8, 15.5, 14.1, 14.4, 15.2, 15.0],
                        ['Colts',            14.1, 14.5, 14.9, 15.6, 14.5, 14.2, 14.8, 14.7],
                        ['Madison Scouts',   13.8, 14.2, 14.7, 14.7, 15.8, 14.0, 13.8, 14.2],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of riverCityScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('river_city_rhapsody_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded River City Rhapsody 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: River City Rhapsody 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (river city scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed The Kiwanis Thunder of Drums (2026-07-07) scores.
        // Qualifying breakdown for the corps competing here:
        //   The Cavaliers  — seq 2 (River City Rhapsody)                          → not qualifying
        //   Colts          — seq 3 (Nebraska, River City Rhapsody)                → qualifying
        //   Blue Knights   — seq 4 (Rockies, Corps Encore, Nebraska)              → not qualifying
        //   Madison Scouts — seq 2 (River City Rhapsody)                          → not qualifying
        //   Genesis        — seq 4 (Rockies, Corps Encore, Nebraska)              → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'kiwanis_thunder_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'The Kiwanis Thunder of Drums' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const kiwanisScores = [
                        ['The Cavaliers',  15.60, 15.20, 16.40, 15.60, 15.60, 15.10, 15.90, 15.80],
                        ['Colts',          14.30, 14.90, 15.60, 15.50, 15.10, 14.60, 15.20, 15.20],
                        ['Blue Knights',   14.60, 15.30, 15.40, 14.50, 15.40, 14.10, 15.10, 15.10],
                        ['Madison Scouts', 14.80, 14.60, 15.00, 14.90, 14.70, 14.30, 14.50, 14.80],
                        ['Genesis',        13.50, 13.60, 14.20, 14.40, 13.30, 13.50, 13.10, 13.30],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of kiwanisScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('kiwanis_thunder_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded The Kiwanis Thunder of Drums 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: The Kiwanis Thunder of Drums 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (kiwanis scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Drums Across the Smokies (2026-07-07) scores.
        // Qualifying breakdown for the corps competing here:
        //   Boston Crusaders  — seq 1 (no prior shows) → qualifying
        //   Carolina Crown    — seq 1 (no prior shows) → qualifying
        //   Spirit of Atlanta — seq 1 (no prior shows) → qualifying
        //   Music City        — seq 1 (no prior shows) → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'smokies_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Drums Across the Smokies' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const smokiesScores = [
                        ['Boston Crusaders',  16.6, 16.6, 16.5, 16.6, 16.7, 16.7, 16.3, 16.7],
                        ['Carolina Crown',    16.8, 16.8, 15.9, 16.7, 16.2, 16.4, 16.6, 16.2],
                        ['Spirit of Atlanta', 14.1, 14.6, 15.3, 14.3, 14.4, 14.9, 14.1, 14.7],
                        ['Music City',        13.0, 13.9, 14.4, 13.7, 13.9, 14.2, 13.1, 13.4],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of smokiesScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('smokies_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Drums Across the Smokies 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Drums Across the Smokies 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (smokies scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Drums Across America (2026-07-08) scores.
        // Qualifying breakdown for the corps competing here:
        //   Boston Crusaders  — seq 2 (Smokies) → not qualifying
        //   Spirit of Atlanta — seq 2 (Smokies) → not qualifying
        //   Music City        — seq 2 (Smokies) → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'drums_across_america_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Drums Across America' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const daaScores = [
                        ['Boston Crusaders',  16.8, 17.1, 16.3, 16.9, 16.9, 16.8, 16.6, 16.6],
                        ['Spirit of Atlanta', 14.9, 15.0, 15.7, 14.4, 15.1, 15.0, 14.9, 15.0],
                        ['Music City',        13.3, 14.0, 14.9, 13.9, 14.4, 14.3, 13.4, 13.8],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of daaScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('drums_across_america_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Drums Across America 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Drums Across America 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (drums across america scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Gold Showcase (2026-07-09) scores.
        // Qualifying breakdown for the corps competing here:
        //   Bluecoats            — seq 3 (Cap Classic, DCI West)                       → qualifying
        //   Blue Devils          — seq 4 (Rockies, Corps Encore, DCI West)             → not qualifying
        //   Santa Clara Vanguard — seq 5 (NW Seattle, NW Portland, Cap Cl., DCI West)  → qualifying
        //   Pacific Crest        — seq 1 (no prior shows)                              → qualifying
        //   The Academy          — seq 3 (Cap Classic, DCI West)                       → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'gold_showcase_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Gold Showcase' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const goldShowcaseScores = [
                        ['Bluecoats',            17.4, 16.9, 16.8, 17.2, 17.1, 17.0, 17.1, 17.0],
                        ['Blue Devils',          17.3, 16.6, 16.7, 16.7, 17.0, 16.9, 16.7, 16.8],
                        ['Santa Clara Vanguard', 16.6, 16.4, 17.0, 16.6, 16.6, 16.5, 16.6, 16.5],
                        ['Pacific Crest',        14.1, 14.5, 14.4, 14.5, 14.4, 14.3, 14.1, 14.6],
                        ['The Academy',          14.2, 14.4, 14.3, 14.3, 14.6, 14.5, 13.8, 14.1],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of goldShowcaseScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('gold_showcase_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Gold Showcase 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Gold Showcase 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (gold showcase scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Northern Alabama (2026-07-09) scores.
        // Qualifying breakdown for the corps competing here:
        //   Boston Crusaders  — seq 3 (Smokies, Drums Across America) → qualifying
        //   Spirit of Atlanta — seq 3 (Smokies, Drums Across America) → qualifying
        //   Music City        — seq 3 (Smokies, Drums Across America) → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_northern_alabama_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Northern Alabama' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const nAlabamaScores = [
                        ['Boston Crusaders',  16.8, 17.0, 16.8, 16.8, 17.0, 16.9, 16.9, 17.0],
                        ['Spirit of Atlanta', 15.1, 14.9, 16.0, 14.7, 15.3, 15.4, 15.2, 15.3],
                        ['Music City',        14.4, 14.3, 15.5, 14.0, 14.4, 14.2, 14.1, 13.6],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of nAlabamaScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_northern_alabama_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Northern Alabama 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Northern Alabama 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci northern alabama scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Western Corps Connection (2026) scores.
        // Qualifying (counts): Blue Devils (5th), Seattle Cascades (5th).
        // Recorded but not qualifying at time of entry: Bluecoats (4th),
        // Santa Clara Vanguard (6th), Pacific Crest (2nd), The Academy (4th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'wcc_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Western Corps Connection' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const wccScores = [
                        ['Bluecoats',            17.5, 17.5, 17.1, 17.4, 17.4, 17.3, 17.3, 17.3],
                        ['Blue Devils',          17.2, 17.2, 16.7, 17.2, 17.1, 17.1, 17.1, 16.7],
                        ['Santa Clara Vanguard', 16.9, 16.7, 16.9, 16.6, 16.8, 16.7, 16.7, 16.6],
                        ['Pacific Crest',        14.2, 14.9, 15.1, 15.1, 15.0, 14.6, 14.4, 15.3],
                        ['The Academy',          14.3, 14.8, 14.9, 14.8, 14.7, 14.7, 14.2, 14.8],
                        ['Seattle Cascades',     13.3, 13.9, 13.6, 13.8, 13.8, 14.1, 13.3, 14.0],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of wccScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('wcc_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Western Corps Connection 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Western Corps Connection 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (western corps connection scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Cavalcade of Brass (2026) scores.
        // Qualifying (counts): Crossmen (1st), Spartans (1st), The Cavaliers (3rd), Troopers (5th).
        // Recorded but not qualifying at time of entry: Phantom Regiment (4th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'cavalcade_of_brass_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Cavalcade of Brass' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const cavalcadeScores = [
                        ['Phantom Regiment', 16.0, 15.8, 16.4, 16.3, 16.1, 16.1, 16.4, 16.3],
                        ['The Cavaliers',    16.2, 15.6, 16.3, 15.8, 16.0, 15.4, 15.6, 15.9],
                        ['Troopers',         15.3, 15.1, 16.0, 15.0, 15.1, 15.3, 15.7, 15.3],
                        ['Crossmen',         15.6, 14.6, 15.3, 14.3, 14.4, 14.3, 13.5, 14.0],
                        ['Spartans',         14.3, 14.1, 14.2, 14.6, 13.9, 13.6, 14.2, 14.1],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of cavalcadeScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('cavalcade_of_brass_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Cavalcade of Brass 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Cavalcade of Brass 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (cavalcade of brass scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Music on the March (2026) scores.
        // Qualifying (counts): Blue Knights (5th), Madison Scouts (3rd), Genesis (5th).
        // Recorded but not qualifying at time of entry: Blue Stars (2nd), Colts (4th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'music_on_the_march_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Music on the March' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const motmScores = [
                        ['Blue Stars',     16.4, 15.6, 16.2, 15.8, 16.3, 16.2, 16.3, 16.3],
                        ['Colts',          15.5, 14.5, 16.0, 15.7, 16.0, 15.7, 15.7, 15.7],
                        ['Blue Knights',   15.0, 15.4, 15.6, 14.6, 15.7, 15.1, 16.0, 16.0],
                        ['Madison Scouts', 15.3, 14.8, 15.2, 15.1, 15.3, 14.9, 15.3, 15.3],
                        ['Genesis',        14.1, 13.7, 14.8, 14.2, 13.7, 14.0, 14.3, 13.9],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of motmScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('music_on_the_march_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Music on the March 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Music on the March 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (music on the march scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Drum Corps at the Rose Bowl (2026-07-11) scores.
        // Music Analysis was scored by a double panel — the values below are the
        // average of the two panelists (rounded to 2 decimals).
        // Qualifying breakdown:
        //   Bluecoats        — seq 5 (Cap Classic, DCI West, Gold Showcase, WCC)                      → qualifying
        //   Blue Devils      — seq 6 (Rockies, Corps Encore, DCI West, Gold Showcase, WCC)            → not qualifying
        //   SCV              — seq 7 (NW Seattle, NW Portland, Cap Classic, DCI West, Gold Sh., WCC)  → qualifying (Rose Bowl not a regional)
        //   Pacific Crest    — seq 3 (Gold Showcase, WCC)                                             → qualifying
        //   The Academy      — seq 5 (Cap Classic, DCI West, Gold Showcase, WCC)                      → qualifying
        //   Seattle Cascades — seq 6 (NW Seattle, NW Portland, Cap Classic, DCI West, WCC)            → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'rose_bowl_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Drum Corps at the Rose Bowl' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const roseBowlScores = [
                        ['Bluecoats',            17.7, 17.45, 17.1, 17.7, 17.5, 17.8, 17.3, 17.3],
                        ['Blue Devils',          17.9, 17.15, 16.8, 17.5, 17.3, 17.5, 17.0, 17.4],
                        ['Santa Clara Vanguard', 17.4, 16.80, 17.3, 16.7, 16.8, 17.0, 16.6, 16.9],
                        ['Pacific Crest',        14.4, 14.95, 15.3, 15.5, 15.6, 15.2, 15.1, 15.6],
                        ['The Academy',          14.7, 14.60, 14.8, 14.9, 15.1, 15.0, 15.0, 15.0],
                        ['Seattle Cascades',     13.8, 13.85, 13.6, 14.0, 14.3, 14.2, 14.2, 13.7],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of roseBowlScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('rose_bowl_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Drum Corps at the Rose Bowl 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Drum Corps at the Rose Bowl 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (rose bowl scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed The Whitewater Classic (2026-07-11) scores.
        // Music Analysis was scored by a double panel — the values below are the
        // average of the two panelists.
        // Qualifying breakdown:
        //   Phantom Regiment — seq 5 → qualifying
        //   Blue Stars       — seq 3 → qualifying
        //   The Cavaliers    — seq 4 → not qualifying
        //   Troopers         — seq 6 → not qualifying
        //   Blue Knights     — seq 6 → not qualifying
        //   Madison Scouts   — seq 4 → not qualifying
        //   Crossmen         — seq 2 → not qualifying
        //   Spartans         — seq 2 → not qualifying
        //   Genesis          — seq 6 → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'whitewater_classic_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'The Whitewater Classic' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const whitewaterScores = [
                        ['Phantom Regiment', 16.8, 16.30, 17.0, 16.4, 16.3, 17.1, 16.8, 16.6],
                        ['Blue Stars',       16.6, 16.35, 16.3, 16.0, 16.4, 16.8, 16.2, 16.0],
                        ['The Cavaliers',    16.1, 15.75, 16.9, 15.9, 16.2, 16.5, 16.0, 15.9],
                        ['Troopers',         15.9, 15.45, 16.2, 15.1, 15.5, 15.5, 15.8, 15.4],
                        ['Blue Knights',     15.4, 15.70, 15.5, 15.0, 15.4, 15.7, 15.5, 15.0],
                        ['Madison Scouts',   16.4, 15.05, 15.7, 15.4, 15.3, 15.3, 15.2, 14.9],
                        ['Crossmen',         14.9, 14.80, 14.5, 14.4, 14.7, 15.1, 14.8, 14.0],
                        ['Spartans',         14.1, 14.20, 14.0, 14.6, 14.1, 14.3, 14.6, 14.2],
                        ['Genesis',          14.3, 14.15, 14.6, 14.1, 13.6, 14.1, 13.8, 13.4],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of whitewaterScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('whitewater_classic_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded The Whitewater Classic 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: The Whitewater Classic 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (whitewater scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed Brass Impact (2026-07-13) scores.
        // Qualifying breakdown:
        //   Phantom Regiment — seq 6 → not qualifying
        //   Blue Stars       — seq 4 → not qualifying
        //   Troopers         — seq 7 → qualifying (Brass Impact not a regional; seq 6 Whitewater no longer counts)
        //   Colts            — seq 5 → qualifying
        //   Madison Scouts   — seq 5 → qualifying
        //   Crossmen         — seq 3 → qualifying
        //   Spartans         — seq 3 → qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'brass_impact_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'Brass Impact' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const brassImpactScores = [
                        ['Phantom Regiment', 16.7, 16.6, 16.8, 16.7, 17.1, 16.8, 17.0, 17.0],
                        ['Blue Stars',       16.4, 16.3, 16.4, 16.9, 17.0, 16.6, 16.7, 16.5],
                        ['Troopers',         15.6, 16.0, 16.1, 15.7, 15.9, 16.1, 15.9, 15.8],
                        ['Colts',            15.4, 14.9, 15.4, 16.4, 15.5, 15.9, 16.1, 15.6],
                        ['Madison Scouts',   15.5, 15.6, 15.5, 15.9, 15.8, 15.6, 15.6, 15.3],
                        ['Crossmen',         15.0, 15.2, 15.0, 15.1, 15.2, 15.0, 14.9, 14.7],
                        ['Spartans',         14.3, 14.5, 13.9, 15.0, 14.3, 13.9, 13.8, 14.6],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of brassImpactScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('brass_impact_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded Brass Impact 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: Brass Impact 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (brass impact scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI New Mexico (2026-07-14) scores.
        // Qualifying breakdown:
        //   Bluecoats        — seq 6 → not qualifying
        //   Pacific Crest    — seq 4 → not qualifying
        //   The Academy      — seq 6 → not qualifying
        //   Seattle Cascades — seq 7 → qualifying (NM not a regional; seq 6 Rose Bowl drops)
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_new_mexico_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI New Mexico' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const nmScores = [
                        ['Bluecoats',        17.9, 18.0, 17.4, 17.7, 17.9, 18.2, 17.9, 17.5],
                        ['Pacific Crest',    14.7, 15.3, 15.6, 15.8, 15.9, 15.5, 15.5, 15.7],
                        ['The Academy',      15.0, 14.8, 14.3, 15.1, 15.4, 15.1, 14.8, 14.9],
                        ['Seattle Cascades', 14.3, 13.9, 13.2, 14.7, 14.7, 13.8, 14.3, 13.8],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of nmScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_new_mexico_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI New Mexico 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI New Mexico 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (new mexico scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Broken Arrow (2026-07-14) scores.
        // Qualifying breakdown:
        //   Boston Crusaders  — seq 4 → not qualifying
        //   Carolina Crown    — seq 2 → not qualifying
        //   Phantom Regiment  — seq 7 → qualifying (Broken Arrow not a regional; seq 6 Brass Impact drops)
        //   The Cavaliers     — seq 5 → qualifying
        //   Colts             — seq 6 → not qualifying
        //   Spirit of Atlanta — seq 4 → not qualifying
        //   Crossmen          — seq 4 → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_broken_arrow_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Broken Arrow' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const brokenArrowScores = [
                        ['Boston Crusaders',  17.6, 17.3, 17.9, 17.9, 17.6, 17.2, 17.2, 17.7],
                        ['Carolina Crown',    17.7, 17.5, 16.7, 17.8, 17.8, 17.0, 17.4, 17.6],
                        ['Phantom Regiment',  17.0, 17.0, 17.1, 17.1, 17.3, 16.8, 16.6, 17.0],
                        ['The Cavaliers',     16.7, 16.3, 17.0, 17.0, 16.8, 16.4, 16.7, 16.6],
                        ['Colts',             16.0, 15.6, 16.1, 16.6, 15.8, 16.0, 15.7, 15.7],
                        ['Spirit of Atlanta', 15.7, 15.8, 15.6, 15.7, 16.0, 15.6, 15.3, 15.6],
                        ['Crossmen',          15.2, 15.2, 14.7, 15.3, 15.5, 15.2, 14.8, 15.1],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of brokenArrowScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_broken_arrow_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Broken Arrow 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Broken Arrow 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (broken arrow scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Hutchinson (2026-07-14) scores.
        // Qualifying breakdown:
        //   Blue Stars     — seq 5 → qualifying
        //   Troopers       — seq 8 → not qualifying (past the 7th slot)
        //   Blue Knights   — seq 7 → qualifying (Hutchinson not a regional; seq 6 Whitewater drops)
        //   Madison Scouts — seq 6 → not qualifying
        //   Music City     — seq 4 → not qualifying
        //   Spartans       — seq 4 → not qualifying
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_hutchinson_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Hutchinson' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const hutchinsonScores = [
                        ['Blue Stars',     17.0, 16.8, 16.4, 17.1, 16.9, 16.9, 16.9, 16.7],
                        ['Troopers',       16.2, 16.3, 16.9, 16.2, 16.3, 16.6, 16.0, 16.2],
                        ['Blue Knights',   16.5, 16.2, 16.6, 15.0, 16.1, 16.4, 15.9, 15.3],
                        ['Madison Scouts', 15.7, 15.9, 15.0, 16.3, 15.9, 16.0, 15.5, 15.5],
                        ['Music City',     15.1, 14.8, 15.1, 15.2, 14.6, 15.0, 14.3, 13.9],
                        ['Spartans',       14.8, 14.4, 14.2, 15.5, 14.1, 14.3, 14.1, 14.7],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of hutchinsonScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_hutchinson_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Hutchinson 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Hutchinson 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (hutchinson scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Denton (2026) scores.
        // Qualifying (counts): Carolina Crown (3rd), Boston Crusaders (5th),
        // Spirit of Atlanta (5th), Bluecoats (7th — Denton is not a major regional).
        // Recorded but not qualifying at time of entry: Santa Clara Vanguard (8th),
        // Phantom Regiment (8th), Seattle Cascades (8th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_denton_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Denton' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const dentonScores = [
                        ['Bluecoats',            18.2, 17.9, 18.1, 18.2, 18.1, 18.2, 18.1, 17.7],
                        ['Boston Crusaders',     18.0, 17.7, 17.8, 17.9, 17.5, 17.9, 17.8, 17.2],
                        ['Carolina Crown',       17.8, 18.2, 16.7, 17.7, 17.7, 17.5, 17.9, 17.4],
                        ['Santa Clara Vanguard', 17.6, 18.0, 17.6, 17.1, 17.2, 17.3, 17.0, 17.3],
                        ['Phantom Regiment',     17.4, 17.4, 17.4, 17.0, 17.0, 17.1, 17.1, 16.8],
                        ['Spirit of Atlanta',    15.9, 15.7, 16.4, 16.1, 16.0, 15.8, 15.6, 15.6],
                        ['Seattle Cascades',     14.4, 14.6, 14.1, 14.0, 14.1, 14.1, 14.3, 14.0],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of dentonScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_denton_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Denton 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Denton 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci denton scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Central Texas (2026) scores.
        // Qualifying (counts): Music City (5th), Pacific Crest (5th), Colts (7th),
        // Madison Scouts (7th), Genesis (7th — Central Texas is not a major regional).
        // Recorded but not qualifying at time of entry: Blue Knights (8th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_central_texas_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Central Texas' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const centralTexasScores = [
                        ['Blue Knights',   16.3, 16.4, 16.6, 16.4, 16.8, 16.4, 16.5, 16.4],
                        ['Colts',          15.8, 16.5, 17.0, 16.7, 16.9, 16.3, 16.1, 16.3],
                        ['Madison Scouts', 16.0, 16.3, 16.1, 16.2, 16.3, 16.0, 15.7, 16.0],
                        ['Pacific Crest',  15.0, 15.5, 16.3, 16.8, 16.5, 15.6, 15.5, 15.7],
                        ['Music City',     15.3, 14.7, 16.7, 15.7, 15.4, 14.9, 15.2, 14.6],
                        ['Genesis',        14.6, 14.3, 14.1, 15.0, 14.6, 14.7, 14.2, 14.2],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of centralTexasScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_central_texas_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Central Texas 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Central Texas 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci central texas scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Houston (2026) scores.
        // Qualifying (counts): Crossmen (5th), Spartans (5th), Blue Devils (7th),
        // The Academy (7th — Houston is not a major regional).
        // Recorded but not qualifying at time of entry: Carolina Crown (4th),
        // Boston Crusaders (6th), The Cavaliers (6th), Blue Stars (6th),
        // Bluecoats (8th), Genesis (8th).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_houston_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Houston' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const houstonScores = [
                        ['Bluecoats',        18.2, 18.1, 18.3, 18.2, 18.2, 18.1, 18.4, 18.5],
                        ['Boston Crusaders', 17.9, 17.8, 18.2, 17.8, 17.7, 17.9, 18.0, 18.1],
                        ['Blue Devils',      18.1, 17.4, 17.3, 17.7, 18.0, 17.65, 17.6, 18.0],
                        ['Carolina Crown',   17.8, 17.6, 17.5, 17.9, 17.6, 17.6, 18.1, 17.7],
                        ['Blue Stars',       17.2, 16.8, 16.8, 17.0, 17.1, 17.0, 17.0, 17.0],
                        ['The Cavaliers',    16.7, 16.5, 17.4, 16.7, 16.7, 16.6, 17.1, 16.8],
                        ['Crossmen',         15.5, 15.6, 15.2, 15.9, 15.8, 15.5, 15.2, 15.3],
                        ['The Academy',      15.6, 15.4, 15.3, 16.0, 15.3, 15.2, 15.1, 15.2],
                        ['Genesis',          14.7, 14.2, 14.7, 15.1, 14.8, 14.4, 14.5, 14.5],
                        ['Spartans',         14.4, 14.6, 14.3, 15.2, 14.6, 14.6, 14.3, 14.8],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of houstonScores) {
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_houston_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Houston 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Houston 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci houston scores):', err.message.split('\n')[0]);
        }

        // One-time migration: equalize qualifying-show counts to 4.
        // Some corps had fewer than 4 qualifying shows (they competed in fewer
        // events). Per an admin decision, promote each such corps' most-recent
        // non-qualifying show(s) — newest first — until it has 4 qualifying shows,
        // by flagging those specific competition_scores rows force_qualifying = TRUE.
        // The recalc below honors that flag (mirrors server/routes/admin.js). Any
        // FUTURE score migration must likewise use the force_qualifying-aware recalc.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'force_qualifying_equalize_v1' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                // [competition_name, corps_name] — the specific shows to promote to qualifying
                const forced = [
                    ['DCI Houston',      'Carolina Crown'],
                    ['DCI Broken Arrow', 'Carolina Crown'],
                    ['DCI Houston',      'Blue Stars'],
                    ['DCI Houston',      'Boston Crusaders'],
                    ['DCI Houston',      'The Cavaliers'],
                    ['DCI Broken Arrow', 'Crossmen'],
                    ['DCI Broken Arrow', 'Spirit of Atlanta'],
                    ['DCI Hutchinson',   'Music City'],
                    ['DCI Hutchinson',   'Spartans'],
                    ['DCI New Mexico',   'Pacific Crest'],
                ];
                for (const [showName, corps] of forced) {
                    await client.query(`
                        UPDATE competition_scores cs
                        SET force_qualifying = TRUE
                        FROM competitions c
                        WHERE cs.competition_id = c.id AND c.season = 2026
                          AND c.name = $1 AND cs.corps_name = $2
                    `, [showName, corps]);
                }
                // Recalculate corps_stats honoring force_qualifying — mirrors
                // recalculateCorpsAverages() in server/routes/admin.js.
                await client.query(`
                    WITH ranked AS (
                      SELECT
                        cs.corps_name,
                        cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                        cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                        cs.force_qualifying,
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
                         OR force_qualifying
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
                    "INSERT INTO schema_migrations (migration_name) VALUES ('force_qualifying_equalize_v1')"
                );
                console.log('[init-db] Migration: equalized qualifying-show counts to 4 (force_qualifying)');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (force_qualifying equalize):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Southwestern Championship (2026) scores.
        // A championship, so it qualifies for every corps that competed — this is
        // every corps' 5th qualifying show. Captions with two judges (GE1, GE2,
        // Music Analysis) are the average of both judges' TOT, rounded to 2 decimals.
        // The recalc below is the current simplified rule (1st/3rd/5th/7th + championship
        // + force_qualifying); the regional-7th substitution has been removed.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_southwestern_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Southwestern Championship' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const southwesternScores = [
                        ['Bluecoats',            18.90, 18.45, 18.90, 18.40, 18.58, 18.50, 18.00, 18.50],
                        ['Boston Crusaders',     18.50, 18.03, 18.70, 17.90, 18.03, 18.20, 18.20, 18.00],
                        ['Blue Devils',          18.10, 18.10, 18.70, 18.10, 18.18, 18.15, 18.60, 18.20],
                        ['Carolina Crown',       18.40, 18.15, 17.30, 17.80, 18.35, 18.15, 18.30, 17.90],
                        ['Santa Clara Vanguard', 17.70, 17.78, 18.50, 17.30, 17.75, 17.65, 17.80, 17.80],
                        ['Phantom Regiment',     17.50, 17.48, 17.95, 17.10, 17.10, 17.70, 17.30, 17.30],
                        ['Blue Stars',           17.50, 17.43, 17.10, 17.20, 17.05, 17.15, 17.20, 17.00],
                        ['The Cavaliers',        17.10, 17.05, 18.00, 16.60, 16.80, 16.80, 17.40, 16.90],
                        ['Colts',                16.45, 16.63, 17.35, 16.10, 16.05, 16.10, 16.00, 16.00],
                        ['Blue Knights',         16.60, 16.70, 16.80, 15.80, 16.50, 16.55, 16.40, 16.40],
                        ['Troopers',             16.90, 16.40, 16.90, 16.00, 15.90, 16.05, 16.50, 16.00],
                        ['Madison Scouts',       16.20, 16.23, 16.20, 15.70, 15.93, 16.35, 16.00, 16.30],
                        ['Pacific Crest',        15.30, 16.00, 16.40, 16.40, 16.00, 15.95, 15.70, 16.10],
                        ['Spirit of Atlanta',    16.00, 16.10, 16.10, 15.90, 16.10, 15.90, 16.30, 15.60],
                        ['Crossmen',             16.10, 15.65, 15.20, 15.00, 15.45, 15.50, 15.30, 15.50],
                        ['The Academy',          15.10, 15.30, 14.80, 15.30, 15.25, 15.15, 15.40, 15.20],
                        ['Music City',           15.60, 15.25, 15.40, 14.90, 14.95, 15.20, 15.20, 15.00],
                        ['Spartans',             14.50, 14.70, 14.50, 14.70, 14.50, 14.60, 14.50, 14.60],
                        ['Genesis',              14.70, 14.35, 14.70, 14.40, 14.10, 14.50, 14.30, 14.70],
                        ['Seattle Cascades',     14.60, 14.30, 14.60, 14.10, 14.25, 14.40, 14.30, 14.30],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of southwesternScores) {
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
                    // Recalculate corps_stats — simplified qualifying rule (no regional-7th),
                    // force_qualifying-aware. Mirrors recalculateCorpsAverages() in
                    // server/routes/admin.js.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            cs.force_qualifying,
                            c.competition_type,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR force_qualifying
                             OR comp_seq IN (1, 3, 5, 7)
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_southwestern_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Southwestern Championship 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Southwestern Championship 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci southwestern scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Southeastern Championship (2026) scores.
        // A championship, so it qualifies automatically for every corps that competed
        // (these 13 corps' 6th qualifying show — the other 7 will compete at Midwestern).
        // Captions with two judges (GE1, GE2, Music Analysis) are the average of both
        // judges' TOT, rounded to 2 decimals. Recalc is the current simplified rule
        // (1st/3rd/5th/7th + championship + force_qualifying); no regional-7th.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_southeastern_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Southeastern Championship' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const southeasternScores = [
                        ['Bluecoats',         18.70, 18.95, 18.80, 18.90, 18.90, 19.15, 19.10, 18.90],
                        ['Blue Devils',       18.50, 18.88, 18.30, 18.80, 18.75, 18.68, 18.80, 18.70],
                        ['Carolina Crown',    18.80, 18.70, 17.75, 18.40, 18.90, 18.75, 18.60, 18.60],
                        ['Boston Crusaders',  18.10, 18.50, 18.85, 18.30, 18.45, 18.45, 18.70, 18.50],
                        ['Blue Stars',        18.20, 17.95, 17.50, 17.80, 18.00, 17.90, 17.70, 17.90],
                        ['Colts',             17.50, 17.55, 17.60, 17.20, 17.25, 17.55, 17.30, 17.40],
                        ['Troopers',          17.30, 16.95, 17.40, 16.60, 17.00, 16.90, 16.90, 17.10],
                        ['Blue Knights',      16.60, 17.05, 16.90, 16.10, 16.75, 17.10, 16.80, 17.00],
                        ['Spirit of Atlanta', 16.90, 16.65, 16.60, 16.80, 16.85, 16.55, 16.60, 16.50],
                        ['Crossmen',          16.30, 16.10, 15.70, 15.80, 16.25, 16.00, 16.20, 16.10],
                        ['Music City',        16.20, 15.70, 16.50, 15.70, 15.65, 15.75, 15.90, 15.70],
                        ['The Academy',       16.50, 15.30, 16.00, 14.90, 15.90, 15.35, 15.80, 15.50],
                        ['Spartans',          15.00, 14.80, 15.10, 14.80, 15.20, 14.95, 15.00, 15.00],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of southeasternScores) {
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
                    // Recalculate corps_stats — simplified qualifying rule (no regional-7th),
                    // force_qualifying-aware. Mirrors recalculateCorpsAverages() in
                    // server/routes/admin.js.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            cs.force_qualifying,
                            c.competition_type,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR force_qualifying
                             OR comp_seq IN (1, 3, 5, 7)
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_southeastern_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Southeastern Championship 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Southeastern Championship 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci southeastern scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Midwestern Championship (2026) scores.
        // A championship, so it qualifies automatically for every corps that competed
        // (these 7 corps' 6th qualifying show — restores parity: all 20 corps at 6).
        // Captions with two judges (GE1, GE2, Music Analysis) are the average of both
        // judges' TOT, rounded to 2 decimals. Recalc is the current simplified rule
        // (1st/3rd/5th/7th + championship + force_qualifying); no regional-7th.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_midwestern_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Midwestern Championship' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const midwesternScores = [
                        ['Santa Clara Vanguard', 18.50, 18.30, 18.70, 18.30, 18.60, 18.45, 17.40, 18.60],
                        ['Phantom Regiment',     18.20, 17.90, 18.30, 18.00, 17.85, 17.80, 17.20, 18.10],
                        ['The Cavaliers',        17.10, 17.65, 18.60, 17.30, 17.60, 17.40, 17.10, 17.70],
                        ['Pacific Crest',        16.20, 16.70, 17.00, 17.20, 16.65, 16.60, 15.90, 16.90],
                        ['Madison Scouts',       16.90, 16.80, 16.30, 16.60, 16.40, 16.70, 16.20, 17.00],
                        ['Seattle Cascades',     14.90, 14.95, 14.90, 15.40, 15.05, 15.10, 14.80, 14.80],
                        ['Genesis',              15.30, 14.75, 15.50, 14.90, 14.70, 14.95, 14.70, 15.00],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of midwesternScores) {
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
                    // Recalculate corps_stats — simplified qualifying rule (no regional-7th),
                    // force_qualifying-aware. Mirrors recalculateCorpsAverages() in
                    // server/routes/admin.js.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            cs.force_qualifying,
                            c.competition_type,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR force_qualifying
                             OR comp_seq IN (1, 3, 5, 7)
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_midwestern_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Midwestern Championship 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Midwestern Championship 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (dci midwestern scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Eastern Classic Day 1 (2026-07-31) scores.
        // A championship, so it qualifies automatically for every corps that competed.
        // Captions with two judges (GE1, GE2, Music Analysis) are the average of both
        // judges' TOT (Postgres DECIMAL(5,2) rounds any 3rd-decimal values). Recalc is
        // the current simplified rule (1st/3rd/5th/7th + championship + force_qualifying).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_eastern_classic_day1_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Eastern Classic Day 1' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const easternDay1Scores = [
                        ['Bluecoats',         19.30, 19.25,  19.10, 19.40, 19.45, 19.45, 19.50, 19.30],
                        ['Blue Devils',       19.00, 18.90,  18.80, 19.10, 19.20, 19.15, 19.30, 19.10],
                        ['Blue Stars',        18.60, 18.35,  17.70, 18.70, 18.50, 18.35, 18.70, 18.30],
                        ['Colts',             17.30, 18.00,  18.10, 17.20, 17.675, 17.575, 18.20, 17.70],
                        ['Troopers',          17.50, 17.50,  17.40, 17.30, 17.40, 17.55, 17.80, 17.60],
                        ['Spirit of Atlanta', 17.10, 17.15,  17.20, 17.40, 17.25, 17.10, 17.30, 17.20],
                        ['Blue Knights',      16.90, 17.475, 16.90, 16.90, 17.375, 17.15, 17.50, 17.00],
                        ['Music City',        16.30, 16.15,  16.30, 16.20, 16.35, 16.10, 16.60, 16.50],
                        ['Genesis',           15.70, 15.05,  15.20, 15.20, 15.25, 14.80, 15.30, 16.00],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of easternDay1Scores) {
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
                    // Recalculate corps_stats — simplified qualifying rule (no regional-7th),
                    // force_qualifying-aware. Mirrors recalculateCorpsAverages() in
                    // server/routes/admin.js.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            cs.force_qualifying,
                            c.competition_type,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR force_qualifying
                             OR comp_seq IN (1, 3, 5, 7)
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_eastern_classic_day1_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Eastern Classic Day 1 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Eastern Classic Day 1 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (eastern classic day 1 scores):', err.message.split('\n')[0]);
        }

        // One-time migration: seed DCI Eastern Classic Day 2 (2026-08-01) scores.
        // A championship, so it qualifies automatically for every corps that competed.
        // Captions with two judges (GE1, GE2, Music Analysis) are the average of both
        // judges' TOT (Postgres DECIMAL(5,2) rounds any 3rd-decimal values). Recalc is
        // the current simplified rule (1st/3rd/5th/7th + championship + force_qualifying).
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'dci_eastern_classic_day2_2026_scores' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                const comp = await client.query(
                    "SELECT id FROM competitions WHERE name = 'DCI Eastern Classic Day 2' AND season = 2026 LIMIT 1"
                );
                if (comp.rows.length > 0) {
                    const competitionId = comp.rows[0].id;
                    // [corps_name, brass, music_analysis, percussion, color_guard, ge1, ge2, visual_proficiency, visual_analysis]
                    const easternDay2Scores = [
                        ['Carolina Crown',       19.50, 19.00,   18.05, 19.00, 19.275, 19.225, 19.10, 18.90],
                        ['Boston Crusaders',     18.90, 19.00,   18.85, 18.90, 19.025, 19.025, 19.20, 18.85],
                        ['Santa Clara Vanguard', 19.10, 18.725,  18.95, 18.20, 18.90,  18.70,  18.90, 18.65],
                        ['Phantom Regiment',     18.70, 18.45,   18.35, 18.50, 18.45,  18.375, 18.50, 18.40],
                        ['The Cavaliers',        18.50, 18.175,  18.50, 18.00, 18.25,  18.05,  18.30, 18.00],
                        ['Pacific Crest',        17.20, 17.30,   17.25, 17.35, 17.275, 17.125, 17.20, 16.90],
                        ['Madison Scouts',       17.00, 17.25,   16.70, 17.10, 17.15,  17.00,  16.90, 16.85],
                        ['Crossmen',             16.70, 16.725,  16.20, 16.15, 16.65,  16.575, 16.30, 16.55],
                        ['The Academy',          16.40, 16.30,   16.10, 16.40, 16.60,  16.35,  16.50, 16.65],
                        ['Spartans',             15.30, 15.70,   15.10, 16.70, 15.95,  15.75,  15.20, 15.90],
                        ['Seattle Cascades',     15.60, 16.00,   15.00, 16.10, 15.55,  15.675, 15.80, 15.60],
                    ];
                    for (const [name, brass, ma, perc, cg, ge1, ge2, vp, va] of easternDay2Scores) {
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
                    // Recalculate corps_stats — simplified qualifying rule (no regional-7th),
                    // force_qualifying-aware. Mirrors recalculateCorpsAverages() in
                    // server/routes/admin.js.
                    await client.query(`
                        WITH ranked AS (
                          SELECT
                            cs.corps_name,
                            cs.brass, cs.music_analysis, cs.percussion, cs.color_guard,
                            cs.ge1, cs.ge2, cs.visual_proficiency, cs.visual_analysis,
                            cs.force_qualifying,
                            c.competition_type,
                            ROW_NUMBER() OVER (
                              PARTITION BY cs.corps_name ORDER BY c.date ASC
                            ) AS comp_seq
                          FROM competition_scores cs
                          JOIN competitions c ON cs.competition_id = c.id
                          WHERE c.season = 2026
                        ),
                        qualifying AS (
                          SELECT * FROM ranked
                          WHERE competition_type = 'championship'
                             OR force_qualifying
                             OR comp_seq IN (1, 3, 5, 7)
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
                        "INSERT INTO schema_migrations (migration_name) VALUES ('dci_eastern_classic_day2_2026_scores')"
                    );
                    console.log('[init-db] Migration: seeded DCI Eastern Classic Day 2 2026 scores and recalculated corps stats');
                } else {
                    console.warn('[init-db] Migration: DCI Eastern Classic Day 2 2026 not found yet — will retry next deploy');
                }
            }
        } catch (err) {
            console.warn('[init-db] Migration warning (eastern classic day 2 scores):', err.message.split('\n')[0]);
        }

        // One-time migration: enforce one-league-per-user.
        // Removes duplicate league memberships then adds a UNIQUE constraint.
        // Hybrid rule for picking which league to keep:
        //   1. If user is in any league with draft_started OR draft_completed,
        //      keep the most recently joined of those.
        //   2. Otherwise keep the most recently joined league overall.
        // Wrapped in a transaction — any failure rolls back cleanly.
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'one_league_per_user_v1' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                await client.query('BEGIN');
                try {
                    // Find users who are in more than one league
                    const dupUsers = await client.query(`
                        SELECT user_id
                        FROM league_members
                        GROUP BY user_id
                        HAVING COUNT(*) > 1
                    `);

                    console.log(`[init-db] one-league migration: ${dupUsers.rows.length} user(s) in multiple leagues`);

                    for (const { user_id } of dupUsers.rows) {
                        // Pull all their memberships, joined to the league row so we can
                        // see draft state.
                        const memberships = await client.query(`
                            SELECT lm.league_id, lm.joined_at,
                                   l.draft_started, l.draft_completed
                            FROM league_members lm
                            JOIN leagues l ON lm.league_id = l.id
                            WHERE lm.user_id = $1
                            ORDER BY lm.joined_at DESC
                        `, [user_id]);

                        const rows = memberships.rows;
                        // Pick keeper: prefer most-recently-joined of those with an active or completed draft
                        const active = rows.filter(r => r.draft_started || r.draft_completed);
                        const keeper = (active[0] || rows[0]).league_id;

                        for (const r of rows) {
                            if (r.league_id === keeper) continue;
                            console.log(`[init-db] one-league migration: user ${user_id} removed from league ${r.league_id} (kept league ${keeper})`);
                            await client.query('DELETE FROM draft_picks WHERE league_id = $1 AND user_id = $2', [r.league_id, user_id]);
                            await client.query('DELETE FROM draft_sessions WHERE league_id = $1 AND user_id = $2', [r.league_id, user_id]);
                            await client.query('DELETE FROM league_members WHERE league_id = $1 AND user_id = $2', [r.league_id, user_id]);
                        }
                    }

                    // Now safe to add the constraint
                    await client.query(`
                        ALTER TABLE league_members
                        ADD CONSTRAINT league_members_user_unique UNIQUE (user_id)
                    `);

                    await client.query(
                        "INSERT INTO schema_migrations (migration_name) VALUES ('one_league_per_user_v1')"
                    );
                    await client.query('COMMIT');
                    console.log('[init-db] Migration: one_league_per_user_v1 complete — UNIQUE constraint added');
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    throw txErr;
                }
            }
        } catch (err) {
            console.error('[init-db] one-league migration FAILED:', err.message);
            // Re-throw so the outer catch exits the process — deploy fails fast
            // rather than running with broken constraints.
            throw err;
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
