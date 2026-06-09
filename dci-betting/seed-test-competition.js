/**
 * Seed a test competition with scores for all 18 corps.
 * Run: node seed-test-competition.js
 * Delete: use the Admin Panel → Competitions tab and delete "TEST - Sample Show"
 */

require('dotenv').config();
const db = require('./database/db');

const COMPETITION_NAME = 'TEST - Sample Show';
const COMPETITION_DATE = '2026-06-26';
const COMPETITION_LOCATION = 'Test City, XX';

// Realistic-looking scores for a first show of the season (ranked order)
// Each caption is out of ~20; all 8 captions sum to the total
const TEST_SCORES = [
    { corps_name: 'Blue Devils',           brass: 10.50, music_analysis: 10.20, percussion: 10.40, color_guard: 10.30, ge1: 10.45, ge2: 10.35, visual_proficiency: 10.15, visual_analysis: 10.25 },
    { corps_name: 'Santa Clara Vanguard',  brass: 10.30, music_analysis: 10.00, percussion: 10.20, color_guard: 10.40, ge1: 10.25, ge2: 10.15, visual_proficiency: 10.10, visual_analysis: 10.00 },
    { corps_name: 'Bluecoats',             brass: 10.10, music_analysis:  9.90, percussion: 10.00, color_guard: 10.20, ge1: 10.05, ge2:  9.95, visual_proficiency:  9.85, visual_analysis:  9.95 },
    { corps_name: 'Carolina Crown',        brass:  9.95, music_analysis:  9.75, percussion:  9.85, color_guard:  9.70, ge1:  9.90, ge2:  9.80, visual_proficiency:  9.70, visual_analysis:  9.65 },
    { corps_name: 'The Cavaliers',         brass:  9.70, music_analysis:  9.50, percussion:  9.60, color_guard:  9.45, ge1:  9.65, ge2:  9.55, visual_proficiency:  9.40, visual_analysis:  9.45 },
    { corps_name: 'Boston Crusaders',      brass:  9.55, music_analysis:  9.35, percussion:  9.45, color_guard:  9.50, ge1:  9.50, ge2:  9.40, visual_proficiency:  9.30, visual_analysis:  9.35 },
    { corps_name: 'Phantom Regiment',      brass:  9.40, music_analysis:  9.20, percussion:  9.30, color_guard:  9.25, ge1:  9.35, ge2:  9.25, visual_proficiency:  9.15, visual_analysis:  9.10 },
    { corps_name: 'Blue Stars',            brass:  9.20, music_analysis:  9.00, percussion:  9.10, color_guard:  9.05, ge1:  9.15, ge2:  9.05, visual_proficiency:  8.95, visual_analysis:  8.90 },
    { corps_name: 'Madison Scouts',        brass:  9.05, music_analysis:  8.85, percussion:  8.95, color_guard:  8.80, ge1:  9.00, ge2:  8.90, visual_proficiency:  8.75, visual_analysis:  8.70 },
    { corps_name: 'Blue Knights',          brass:  8.90, music_analysis:  8.70, percussion:  8.80, color_guard:  8.75, ge1:  8.85, ge2:  8.75, visual_proficiency:  8.60, visual_analysis:  8.65 },
    { corps_name: 'Crossmen',              brass:  8.70, music_analysis:  8.50, percussion:  8.60, color_guard:  8.55, ge1:  8.65, ge2:  8.55, visual_proficiency:  8.40, visual_analysis:  8.45 },
    { corps_name: 'Spirit of Atlanta',     brass:  8.55, music_analysis:  8.35, percussion:  8.45, color_guard:  8.40, ge1:  8.50, ge2:  8.40, visual_proficiency:  8.25, visual_analysis:  8.30 },
    { corps_name: 'Pacific Crest',         brass:  8.20, music_analysis:  8.00, percussion:  8.10, color_guard:  8.05, ge1:  8.15, ge2:  8.05, visual_proficiency:  7.90, visual_analysis:  7.95 },
    { corps_name: 'Music City',            brass:  8.05, music_analysis:  7.85, percussion:  7.95, color_guard:  7.90, ge1:  8.00, ge2:  7.90, visual_proficiency:  7.75, visual_analysis:  7.80 },
    { corps_name: 'The Academy',           brass:  7.90, music_analysis:  7.70, percussion:  7.80, color_guard:  7.75, ge1:  7.85, ge2:  7.75, visual_proficiency:  7.60, visual_analysis:  7.65 },
    { corps_name: 'Troopers',              brass:  7.70, music_analysis:  7.50, percussion:  7.60, color_guard:  7.55, ge1:  7.65, ge2:  7.55, visual_proficiency:  7.40, visual_analysis:  7.45 },
    { corps_name: 'Colts',                 brass:  7.55, music_analysis:  7.35, percussion:  7.45, color_guard:  7.40, ge1:  7.50, ge2:  7.40, visual_proficiency:  7.25, visual_analysis:  7.30 },
    { corps_name: 'Spartans',              brass:  7.20, music_analysis:  7.00, percussion:  7.10, color_guard:  7.05, ge1:  7.15, ge2:  7.05, visual_proficiency:  6.90, visual_analysis:  6.95 },
];

async function seed() {
    try {
        // 1. Insert competition
        const existing = await db.query(
            'SELECT id FROM competitions WHERE name = $1 AND season = 2026',
            [COMPETITION_NAME]
        );

        // Ensure schema columns exist on older local DBs
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS brass DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS music_analysis DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS percussion DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS color_guard DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS ge1 DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS ge2 DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS visual_proficiency DECIMAL(5,2)`);
        await db.query(`ALTER TABLE competition_scores ADD COLUMN IF NOT EXISTS visual_analysis DECIMAL(5,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_music_analysis DECIMAL(6,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_color_guard DECIMAL(6,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_ge1 DECIMAL(6,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_ge2 DECIMAL(6,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_visual_proficiency DECIMAL(6,2)`);
        await db.query(`ALTER TABLE corps_stats ADD COLUMN IF NOT EXISTS avg_visual_analysis DECIMAL(6,2)`);
        // Ensure competition_type column exists (may be missing on older local DBs)
        await db.query(`ALTER TABLE competitions ADD COLUMN IF NOT EXISTS competition_type VARCHAR(50) DEFAULT 'regular'`);

        let competitionId;
        if (existing.rows.length > 0) {
            competitionId = existing.rows[0].id;
            console.log(`Competition already exists (id=${competitionId}), replacing scores...`);
        } else {
            const result = await db.query(
                `INSERT INTO competitions (name, date, location, season, competition_type)
                 VALUES ($1, $2, $3, 2026, 'regular') RETURNING id`,
                [COMPETITION_NAME, COMPETITION_DATE, COMPETITION_LOCATION]
            );
            competitionId = result.rows[0].id;
            console.log(`Created competition id=${competitionId}`);
        }

        // 2. Wipe any existing scores for this competition then insert fresh
        await db.query('DELETE FROM competition_scores WHERE competition_id = $1', [competitionId]);

        for (const s of TEST_SCORES) {
            const total = s.brass + s.music_analysis + s.percussion + s.color_guard
                        + s.ge1 + s.ge2 + s.visual_proficiency + s.visual_analysis;
            await db.query(
                `INSERT INTO competition_scores
                   (competition_id, corps_name, brass, music_analysis, percussion, color_guard,
                    ge1, ge2, visual_proficiency, visual_analysis, total_score)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [competitionId, s.corps_name, s.brass, s.music_analysis, s.percussion,
                 s.color_guard, s.ge1, s.ge2, s.visual_proficiency, s.visual_analysis,
                 Math.round(total * 100) / 100]
            );
            console.log(`  ${s.corps_name}: ${Math.round(total * 100) / 100}`);
        }

        // 3. Recalculate corps_stats from all qualifying competitions
        await db.query(`
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
                ROUND(SUM(brass)::numeric, 2)              AS sum_brass,
                ROUND(SUM(music_analysis)::numeric, 2)     AS sum_music_analysis,
                ROUND(SUM(percussion)::numeric, 2)         AS sum_percussion,
                ROUND(SUM(color_guard)::numeric, 2)        AS sum_color_guard,
                ROUND(SUM(ge1)::numeric, 2)                AS sum_ge1,
                ROUND(SUM(ge2)::numeric, 2)                AS sum_ge2,
                ROUND(SUM(visual_proficiency)::numeric, 2) AS sum_visual_proficiency,
                ROUND(SUM(visual_analysis)::numeric, 2)    AS sum_visual_analysis,
                COUNT(*) AS qualifying_count
              FROM qualifying GROUP BY corps_name
            )
            UPDATE corps_stats cs_outer SET
              avg_brass              = t.sum_brass,
              avg_music_analysis     = t.sum_music_analysis,
              avg_percussion         = t.sum_percussion,
              avg_color_guard        = t.sum_color_guard,
              avg_ge1                = t.sum_ge1,
              avg_ge2                = t.sum_ge2,
              avg_visual_proficiency = t.sum_visual_proficiency,
              avg_visual_analysis    = t.sum_visual_analysis,
              total_score            = t.sum_brass + t.sum_music_analysis + t.sum_percussion
                                     + t.sum_color_guard + t.sum_ge1 + t.sum_ge2
                                     + t.sum_visual_proficiency + t.sum_visual_analysis,
              competitions_count     = t.qualifying_count,
              updated_at             = NOW()
            FROM totals t
            WHERE cs_outer.corps_name = t.corps_name AND cs_outer.season = 2026
        `);

        console.log('\nCorps stats recalculated.');
        console.log(`\nDone. Delete via Admin Panel → Competitions → "${COMPETITION_NAME}" → Delete.`);
        process.exit(0);
    } catch (err) {
        console.error('Seed failed:', err.message);
        process.exit(1);
    }
}

seed();
