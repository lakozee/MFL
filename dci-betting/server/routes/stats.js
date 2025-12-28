const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// Get team statistics
router.get('/team/:teamId', authenticateToken, async (req, res) => {
    try {
        const teamId = req.params.teamId;
        const userId = req.user.userId;

        // Get team and verify access
        const teamResult = await db.query(
            'SELECT lm.*, l.id as league_id FROM league_members lm JOIN leagues l ON lm.league_id = l.id WHERE lm.id = $1',
            [teamId]
        );

        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const team = teamResult.rows[0];

        // Verify user is in same league
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [team.league_id, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Get team's picks with scores (from app.js state data)
        const picksResult = await db.query(
            'SELECT * FROM draft_picks WHERE league_id = $1 AND user_id = $2 ORDER BY pick_number',
            [team.league_id, team.user_id]
        );

        res.json({
            team: {
                name: team.team_name,
                position: team.draft_position
            },
            picks: picksResult.rows
        });
    } catch (error) {
        console.error('Get team stats error:', error);
        res.status(500).json({ error: 'Failed to fetch team statistics' });
    }
});

// Get league leaderboard
router.get('/league/:leagueId', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.leagueId;
        const userId = req.user.userId;

        // Verify user is member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Get all teams with their picks count
        const teamsResult = await db.query(`
      SELECT lm.*, u.username, u.profile_picture_url,
             (SELECT COUNT(*) FROM draft_picks WHERE league_id = $1 AND user_id = lm.user_id) as picks_count
      FROM league_members lm
      JOIN users u ON lm.user_id = u.id
      WHERE lm.league_id = $1
      ORDER BY lm.draft_position
    `, [leagueId]);

        res.json({
            teams: teamsResult.rows
        });
    } catch (error) {
        console.error('Get league stats error:', error);
        res.status(500).json({ error: 'Failed to fetch league statistics' });
    }
});

// Get all corps scores
router.get('/corps', async (req, res) => {
    try {
        const { sort = 'name' } = req.query;

        let orderBy = 'corps_name ASC';
        if (sort === 'score') orderBy = 'total_score DESC';
        if (sort === 'date') orderBy = 'updated_at DESC';

        const result = await db.query(
            `SELECT * FROM corps_stats WHERE season = 2025 ORDER BY ${orderBy}`
        );

        res.json({ corps: result.rows });
    } catch (error) {
        console.error('Get corps stats error:', error);
        res.status(500).json({ error: 'Failed to fetch corps statistics' });
    }
});

// Get specific corps history
router.get('/corps/:name', async (req, res) => {
    try {
        const corpsName = req.params.name;

        const result = await db.query(
            'SELECT * FROM corps_stats WHERE corps_name = $1 ORDER BY season DESC',
            [corpsName]
        );

        res.json({ history: result.rows });
    } catch (error) {
        console.error('Get corps history error:', error);
        res.status(500).json({ error: 'Failed to fetch corps history' });
    }
});

module.exports = router;
