const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../../database/db');
const { adminAuth } = require('../middleware/adminAuth');
const { scrapeCompetitionList, scrapeCompetitionScores, scrapeEvents, detectCompetitionType } = require('../utils/dciScraper');

// Apply adminAuth to all routes in this file
router.use(adminAuth);

// ─── Helper: recalculate corps scores from qualifying competitions only ────────
// Qualifying shows: each corps' 1st, 3rd, 5th, 7th competition (by date) +
// any show flagged as competition_type = 'championship'.
// Scores are summed (not averaged) across qualifying shows.
async function recalculateCorpsAverages() {
    await db.query(`
        WITH ranked AS (
          SELECT
            cs.corps_name,
            cs.brass, cs.percussion, cs.guard, cs.ge, cs.visual,
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
             OR comp_seq IN (1, 3, 5, 7)
        ),
        totals AS (
          SELECT
            corps_name,
            ROUND(SUM(brass)::numeric, 2)      AS sum_brass,
            ROUND(SUM(percussion)::numeric, 2) AS sum_percussion,
            ROUND(SUM(guard)::numeric, 2)      AS sum_guard,
            ROUND(SUM(ge)::numeric, 2)         AS sum_ge,
            ROUND(SUM(visual)::numeric, 2)     AS sum_visual,
            COUNT(*)                           AS qualifying_count
          FROM qualifying
          GROUP BY corps_name
        )
        UPDATE corps_stats cs_outer
        SET
          avg_brass         = t.sum_brass,
          avg_percussion    = t.sum_percussion,
          avg_guard         = t.sum_guard,
          avg_ge            = t.sum_ge,
          avg_visual        = t.sum_visual,
          total_score       = t.sum_brass + t.sum_percussion + t.sum_guard + t.sum_ge + t.sum_visual,
          competitions_count = t.qualifying_count,
          updated_at        = NOW()
        FROM totals t
        WHERE cs_outer.corps_name = t.corps_name AND cs_outer.season = 2026
    `);
}

// ─── GET /api/admin/verify ────────────────────────────────────────────────────
router.get('/verify', (req, res) => {
    res.json({ admin: true });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
              u.id, u.email, u.username, u.is_admin, u.created_at, u.last_login,
              COALESCE(
                json_agg(
                  json_build_object(
                    'league_id', l.id,
                    'league_name', l.name,
                    'team_name', lm.team_name,
                    'is_creator', (l.creator_id = u.id),
                    'team_score', COALESCE(scores.team_score, 0)
                  )
                ) FILTER (WHERE l.id IS NOT NULL),
                '[]'::json
              ) as leagues
            FROM users u
            LEFT JOIN league_members lm ON lm.user_id = u.id
            LEFT JOIN leagues l ON l.id = lm.league_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(
                CASE dp.section_type
                  WHEN 'Brass' THEN cs.avg_brass
                  WHEN 'Percussion' THEN cs.avg_percussion
                  WHEN 'Color Guard' THEN cs.avg_guard
                  WHEN 'General Effect' THEN cs.avg_ge
                  WHEN 'Visual Performance' THEN cs.avg_visual
                  ELSE 0
                END
              ), 0) as team_score
              FROM draft_picks dp
              LEFT JOIN corps_stats cs ON cs.season = 2026 AND cs.corps_name = CASE
                WHEN dp.caption_id LIKE 'bd-%' THEN 'Blue Devils'
                WHEN dp.caption_id LIKE 'scv-%' THEN 'Santa Clara Vanguard'
                WHEN dp.caption_id LIKE 'bloo-%' THEN 'Bluecoats'
                WHEN dp.caption_id LIKE 'crown-%' THEN 'Carolina Crown'
                WHEN dp.caption_id LIKE 'cavs-%' THEN 'The Cavaliers'
                WHEN dp.caption_id LIKE 'bac-%' THEN 'Boston Crusaders'
              END
              WHERE dp.user_id = u.id AND dp.league_id = l.id
            ) scores ON true
            GROUP BY u.id
            ORDER BY u.created_at
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /admin/users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ─── PUT /api/admin/users/:id ─────────────────────────────────────────────────
router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { email, username, is_admin, password } = req.body;

    try {
        // Validate email format if provided
        if (email !== undefined && email !== null) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (email !== undefined) {
            updates.push(`email = $${paramIndex++}`);
            values.push(email);
        }
        if (username !== undefined) {
            updates.push(`username = $${paramIndex++}`);
            values.push(username);
        }
        if (is_admin !== undefined) {
            updates.push(`is_admin = $${paramIndex++}`);
            values.push(Boolean(is_admin));
        }
        if (password && password.trim() !== '') {
            const hash = await bcrypt.hash(password, 10);
            updates.push(`password_hash = $${paramIndex++}`);
            values.push(hash);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);
        const result = await db.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, username, is_admin`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('PUT /admin/users/:id error:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email or username already in use' });
        }
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User deleted' });
    } catch (error) {
        console.error('DELETE /admin/users/:id error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ─── GET /api/admin/leagues ───────────────────────────────────────────────────
router.get('/leagues', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT l.*, u.username as creator_username, u.email as creator_email,
              (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as member_count
            FROM leagues l
            JOIN users u ON l.creator_id = u.id
            ORDER BY l.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /admin/leagues error:', error);
        res.status(500).json({ error: 'Failed to fetch leagues' });
    }
});

// ─── PUT /api/admin/leagues/:id ───────────────────────────────────────────────
router.put('/leagues/:id', async (req, res) => {
    const { id } = req.params;
    const { name, max_players, min_players, reset_draft } = req.body;

    try {
        if (reset_draft) {
            await db.query(`
                UPDATE leagues SET
                  draft_started = false,
                  draft_completed = false,
                  draft_lobby_open = false,
                  current_draft_turn = 0
                WHERE id = $1
            `, [id]);
            await db.query('DELETE FROM draft_picks WHERE league_id = $1', [id]);
            await db.query('DELETE FROM draft_sessions WHERE league_id = $1', [id]);
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (max_players !== undefined) {
            updates.push(`max_players = $${paramIndex++}`);
            values.push(max_players);
        }
        if (min_players !== undefined) {
            updates.push(`min_players = $${paramIndex++}`);
            values.push(min_players);
        }

        let result;
        if (updates.length > 0) {
            values.push(id);
            result = await db.query(
                `UPDATE leagues SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
                values
            );
        } else {
            result = await db.query('SELECT * FROM leagues WHERE id = $1', [id]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('PUT /admin/leagues/:id error:', error);
        res.status(500).json({ error: 'Failed to update league' });
    }
});

// ─── DELETE /api/admin/leagues/:id ───────────────────────────────────────────
router.delete('/leagues/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM leagues WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        res.json({ message: 'League deleted' });
    } catch (error) {
        console.error('DELETE /admin/leagues/:id error:', error);
        res.status(500).json({ error: 'Failed to delete league' });
    }
});

// ─── GET /api/admin/leagues/:id/members ──────────────────────────────────────
router.get('/leagues/:id/members', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT lm.*, u.username, u.email, u.is_admin,
              COALESCE(scores.team_score, 0) as team_score,
              (SELECT COUNT(*) FROM draft_picks WHERE league_id = lm.league_id AND user_id = lm.user_id) as picks_count
            FROM league_members lm
            JOIN users u ON lm.user_id = u.id
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(
                CASE dp.section_type
                  WHEN 'Brass' THEN cs.avg_brass
                  WHEN 'Percussion' THEN cs.avg_percussion
                  WHEN 'Color Guard' THEN cs.avg_guard
                  WHEN 'General Effect' THEN cs.avg_ge
                  WHEN 'Visual Performance' THEN cs.avg_visual
                  ELSE 0
                END
              ), 0) as team_score
              FROM draft_picks dp
              LEFT JOIN corps_stats cs ON cs.season = 2026 AND cs.corps_name = CASE
                WHEN dp.caption_id LIKE 'bd-%' THEN 'Blue Devils'
                WHEN dp.caption_id LIKE 'scv-%' THEN 'Santa Clara Vanguard'
                WHEN dp.caption_id LIKE 'bloo-%' THEN 'Bluecoats'
                WHEN dp.caption_id LIKE 'crown-%' THEN 'Carolina Crown'
                WHEN dp.caption_id LIKE 'cavs-%' THEN 'The Cavaliers'
                WHEN dp.caption_id LIKE 'bac-%' THEN 'Boston Crusaders'
              END
              WHERE dp.user_id = lm.user_id AND dp.league_id = lm.league_id
            ) scores ON true
            WHERE lm.league_id = $1
            ORDER BY lm.draft_position
        `, [id]);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /admin/leagues/:id/members error:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// ─── DELETE /api/admin/leagues/:id/members/:userId ───────────────────────────
router.delete('/leagues/:id/members/:userId', async (req, res) => {
    const { id, userId } = req.params;
    try {
        await db.query('DELETE FROM draft_picks WHERE league_id = $1 AND user_id = $2', [id, userId]);
        await db.query('DELETE FROM draft_sessions WHERE league_id = $1 AND user_id = $2', [id, userId]);
        const result = await db.query(
            'DELETE FROM league_members WHERE league_id = $1 AND user_id = $2 RETURNING user_id',
            [id, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }
        res.json({ message: 'Member removed' });
    } catch (error) {
        console.error('DELETE /admin/leagues/:id/members/:userId error:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

// ─── GET /api/admin/corps ─────────────────────────────────────────────────────
router.get('/corps', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM corps_stats WHERE season = 2026 ORDER BY total_score DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('GET /admin/corps error:', error);
        res.status(500).json({ error: 'Failed to fetch corps stats' });
    }
});

// ─── PUT /api/admin/corps/:id ─────────────────────────────────────────────────
router.put('/corps/:id', async (req, res) => {
    const { id } = req.params;
    const { avg_brass, avg_percussion, avg_guard, avg_ge, avg_visual } = req.body;

    try {
        const total = (parseFloat(avg_brass) || 0) +
                      (parseFloat(avg_percussion) || 0) +
                      (parseFloat(avg_guard) || 0) +
                      (parseFloat(avg_ge) || 0) +
                      (parseFloat(avg_visual) || 0);

        const result = await db.query(`
            UPDATE corps_stats SET
              avg_brass = $1,
              avg_percussion = $2,
              avg_guard = $3,
              avg_ge = $4,
              avg_visual = $5,
              total_score = $6,
              updated_at = NOW()
            WHERE id = $7
            RETURNING *
        `, [avg_brass, avg_percussion, avg_guard, avg_ge, avg_visual, total, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Corps not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('PUT /admin/corps/:id error:', error);
        res.status(500).json({ error: 'Failed to update corps stats' });
    }
});

// ─── GET /api/admin/competitions ─────────────────────────────────────────────
router.get('/competitions', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.*,
              json_agg(
                json_build_object(
                  'id', cs.id, 'corps_name', cs.corps_name,
                  'brass', cs.brass, 'percussion', cs.percussion,
                  'guard', cs.guard, 'ge', cs.ge, 'visual', cs.visual,
                  'total_score', cs.total_score
                ) ORDER BY cs.corps_name
              ) FILTER (WHERE cs.id IS NOT NULL) as scores
            FROM competitions c
            LEFT JOIN competition_scores cs ON cs.competition_id = c.id
            GROUP BY c.id
            ORDER BY c.date DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /admin/competitions error:', error);
        res.status(500).json({ error: 'Failed to fetch competitions' });
    }
});

// ─── POST /api/admin/competitions ────────────────────────────────────────────
router.post('/competitions', async (req, res) => {
    const { name, date, location, season = 2026 } = req.body;

    if (!name || !date) {
        return res.status(400).json({ error: 'Name and date are required' });
    }

    try {
        const result = await db.query(
            'INSERT INTO competitions (name, date, location, season) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, date, location, season]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('POST /admin/competitions error:', error);
        res.status(500).json({ error: 'Failed to create competition' });
    }
});

// ─── PUT /api/admin/competitions/:id ─────────────────────────────────────────
router.put('/competitions/:id', async (req, res) => {
    const { id } = req.params;
    const { name, date, location } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (date !== undefined) {
            updates.push(`date = $${paramIndex++}`);
            values.push(date);
        }
        if (location !== undefined) {
            updates.push(`location = $${paramIndex++}`);
            values.push(location);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);
        const result = await db.query(
            `UPDATE competitions SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Competition not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('PUT /admin/competitions/:id error:', error);
        res.status(500).json({ error: 'Failed to update competition' });
    }
});

// ─── DELETE /api/admin/competitions/:id ──────────────────────────────────────
router.delete('/competitions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM competitions WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Competition not found' });
        }
        await recalculateCorpsAverages();
        res.json({ message: 'Competition deleted' });
    } catch (error) {
        console.error('DELETE /admin/competitions/:id error:', error);
        res.status(500).json({ error: 'Failed to delete competition' });
    }
});

// ─── POST /api/admin/competitions/:id/scores ─────────────────────────────────
router.post('/competitions/:id/scores', async (req, res) => {
    const { id } = req.params;
    const { scores } = req.body;

    if (!scores || !Array.isArray(scores)) {
        return res.status(400).json({ error: 'scores array is required' });
    }

    try {
        // Delete existing scores for this competition, then insert all new ones
        await db.query('DELETE FROM competition_scores WHERE competition_id = $1', [id]);

        for (const s of scores) {
            const total = (parseFloat(s.brass) || 0) +
                          (parseFloat(s.percussion) || 0) +
                          (parseFloat(s.guard) || 0) +
                          (parseFloat(s.ge) || 0) +
                          (parseFloat(s.visual) || 0);

            await db.query(`
                INSERT INTO competition_scores
                  (competition_id, corps_name, brass, percussion, guard, ge, visual, total_score)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [id, s.corps_name, s.brass, s.percussion, s.guard, s.ge, s.visual, total]);
        }

        await recalculateCorpsAverages();

        res.json({ message: 'Scores saved', competition_id: parseInt(id) });
    } catch (error) {
        console.error('POST /admin/competitions/:id/scores error:', error);
        res.status(500).json({ error: 'Failed to save scores' });
    }
});

// ─── Helper: upsert a single competition's scores ─────────────────────────────
async function upsertCompetitionScores(competitionId, scores) {
    // Clear existing scores for this competition then re-insert
    await db.query('DELETE FROM competition_scores WHERE competition_id = $1', [competitionId]);
    for (const s of scores) {
        const total = s.total_score || (
            (parseFloat(s.brass) || 0) +
            (parseFloat(s.percussion) || 0) +
            (parseFloat(s.guard) || 0) +
            (parseFloat(s.ge) || 0) +
            (parseFloat(s.visual) || 0)
        );
        await db.query(
            `INSERT INTO competition_scores
               (competition_id, corps_name, brass, percussion, guard, ge, visual, total_score)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (competition_id, corps_name) DO UPDATE SET
               brass=$3, percussion=$4, guard=$5, ge=$6, visual=$7, total_score=$8`,
            [competitionId, s.corps_name, s.brass, s.percussion, s.guard, s.ge, s.visual, total]
        );

        // Upsert corps_stats row so new corps discovered via scrape are tracked
        await db.query(
            `INSERT INTO corps_stats (corps_name, season, avg_brass, avg_percussion, avg_guard, avg_ge, avg_visual, total_score, competitions_count)
             VALUES ($1, 2026, 0, 0, 0, 0, 0, 0, 0)
             ON CONFLICT (corps_name, season) DO NOTHING`,
            [s.corps_name]
        );
    }
}

// ─── POST /api/admin/sync ─────────────────────────────────────────────────────
// Discover all competitions + events from DCI, upsert them, then sync scores.
router.post('/sync', async (req, res) => {
    const results = { competitions_found: 0, competitions_imported: 0, scores_synced: 0, events_found: 0, events_imported: 0, errors: [] };
    try {
        // Sync competitions and scores
        const competitions = await scrapeCompetitionList();
        results.competitions_found = competitions.length;

        for (const comp of competitions) {
            try {
                const compType = detectCompetitionType(comp.name);
                const upsert = await db.query(
                    `INSERT INTO competitions (name, date, location, season, source_url, competition_type)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (name, season) DO UPDATE SET
                       date = COALESCE(EXCLUDED.date, competitions.date),
                       location = COALESCE(EXCLUDED.location, competitions.location),
                       source_url = COALESCE(EXCLUDED.source_url, competitions.source_url),
                       competition_type = EXCLUDED.competition_type
                     RETURNING id`,
                    [comp.name, comp.date, comp.location, comp.season, comp.source_url, compType]
                );
                const competitionId = upsert.rows[0].id;
                results.competitions_imported++;

                if (comp.source_url) {
                    const scores = await scrapeCompetitionScores(comp.source_url);
                    if (scores.length > 0) {
                        await upsertCompetitionScores(competitionId, scores);
                        await db.query(
                            'UPDATE competitions SET last_synced_at = NOW() WHERE id = $1',
                            [competitionId]
                        );
                        results.scores_synced += scores.length;
                    }
                }
            } catch (err) {
                results.errors.push({ competition: comp.name, error: err.message });
            }
        }

        // Sync events from dci.org/events/ into the competitions table
        try {
            const events = await scrapeEvents();
            results.events_found = events.length;

            for (const ev of events) {
                try {
                    const compType = detectCompetitionType(ev.name);
                    await db.query(
                        `INSERT INTO competitions (name, date, location, season, source_url, competition_type)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (name, season) DO UPDATE SET
                           date = COALESCE(EXCLUDED.date, competitions.date),
                           location = COALESCE(EXCLUDED.location, competitions.location),
                           source_url = COALESCE(EXCLUDED.source_url, competitions.source_url),
                           competition_type = EXCLUDED.competition_type`,
                        [ev.name, ev.date, ev.location, ev.season, ev.source_url, compType]
                    );
                    results.events_imported++;
                } catch (err) {
                    results.errors.push({ competition: ev.name, error: err.message });
                }
            }
        } catch (err) {
            results.errors.push({ competition: 'events scrape', error: err.message });
        }

        await recalculateCorpsAverages();
        res.json({ message: 'Sync complete', ...results });
    } catch (error) {
        console.error('POST /admin/sync error:', error);
        res.status(500).json({ error: error.message, ...results });
    }
});

// ─── POST /api/admin/sync/:id ─────────────────────────────────────────────────
// Sync scores for one specific competition by its DB id.
router.post('/sync/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const compResult = await db.query('SELECT * FROM competitions WHERE id = $1', [id]);
        if (compResult.rows.length === 0) return res.status(404).json({ error: 'Competition not found' });

        const competition = compResult.rows[0];
        if (!competition.source_url) {
            return res.status(400).json({ error: 'No source URL for this competition. Run Sync All first to discover URLs.' });
        }

        const scores = await scrapeCompetitionScores(competition.source_url);
        if (scores.length === 0) {
            return res.status(422).json({ error: 'No scores found on the page. Selectors may need adjustment.' });
        }

        await upsertCompetitionScores(id, scores);
        await db.query('UPDATE competitions SET last_synced_at = NOW() WHERE id = $1', [id]);
        await recalculateCorpsAverages();

        res.json({ message: 'Sync complete', competition: competition.name, scores_synced: scores.length });
    } catch (error) {
        console.error(`POST /admin/sync/${id} error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ─── PUT /api/admin/competitions/:id/type ─────────────────────────────────────
// Manually override the competition_type for a show.
router.put('/competitions/:id/type', async (req, res) => {
    const { id } = req.params;
    const { competition_type } = req.body;
    if (!['championship', 'regular'].includes(competition_type)) {
        return res.status(400).json({ error: 'competition_type must be "championship" or "regular"' });
    }
    try {
        const result = await db.query(
            'UPDATE competitions SET competition_type = $1 WHERE id = $2 RETURNING *',
            [competition_type, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Competition not found' });
        await recalculateCorpsAverages();
        res.json({ message: 'Type updated', competition: result.rows[0] });
    } catch (error) {
        console.error('PUT /admin/competitions/:id/type error:', error);
        res.status(500).json({ error: 'Failed to update competition type' });
    }
});

module.exports = router;
