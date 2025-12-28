const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// Get user's team in a specific league
router.get('/my/:leagueId', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.leagueId;
        const userId = req.user.userId;

        // Get team info
        const result = await db.query(
            'SELECT * FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Not a member of this league' });
        }

        res.json({ team: result.rows[0] });
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({ error: 'Failed to fetch team' });
    }
});

// Update team name
router.put('/my/:leagueId', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.leagueId;
        const userId = req.user.userId;
        const { teamName } = req.body;

        if (!teamName || teamName.length < 3 || teamName.length > 50) {
            return res.status(400).json({ error: 'Team name must be between 3 and 50 characters' });
        }

        // Update team name
        const result = await db.query(
            'UPDATE league_members SET team_name = $1 WHERE league_id = $2 AND user_id = $3 RETURNING *',
            [teamName, leagueId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        res.json({
            message: 'Team name updated',
            team: result.rows[0]
        });
    } catch (error) {
        console.error('Update team error:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

// Get team's drafted roster
router.get('/:teamId/roster', authenticateToken, async (req, res) => {
    try {
        const teamId = req.params.teamId;
        const userId = req.user.userId;

        // Get team's league and verify access
        const teamResult = await db.query(
            'SELECT league_id FROM league_members WHERE id = $1',
            [teamId]
        );

        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const leagueId = teamResult.rows[0].league_id;

        // Verify user is in same league
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to view this team' });
        }

        // Get roster
        const rosterResult = await db.query(
            'SELECT * FROM draft_picks WHERE league_id = $1 AND user_id = (SELECT user_id FROM league_members WHERE id = $2) ORDER BY pick_number',
            [leagueId, teamId]
        );

        res.json({ roster: rosterResult.rows });
    } catch (error) {
        console.error('Get roster error:', error);
        res.status(500).json({ error: 'Failed to fetch roster' });
    }
});

module.exports = router;
