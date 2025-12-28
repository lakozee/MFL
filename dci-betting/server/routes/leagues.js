const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// Create a new league
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.user.userId;

        // Validate input
        if (!name || name.length < 3 || name.length > 100) {
            return res.status(400).json({ error: 'League name must be between 3 and 100 characters' });
        }

        // Create league with default max=12, min=4
        const result = await db.query(
            'INSERT INTO leagues (name, creator_id, max_players, min_players) VALUES ($1, $2, 12, 4) RETURNING *',
            [name, userId]
        );

        const league = result.rows[0];

        // Add creator as first member with default Fantasy Corp Name
        await db.query(
            'INSERT INTO league_members (league_id, user_id, team_name, draft_position) VALUES ($1, $2, $3, $4)',
            [league.id, userId, `${req.user.username}'s Fantasy Corp`, 1]
        );

        res.status(201).json({
            message: 'League created successfully',
            league: {
                id: league.id,
                name: league.name,
                maxPlayers: league.max_players,
                minPlayers: league.min_players,
                createdAt: league.created_at
            }
        });
    } catch (error) {
        console.error('League creation error:', error);
        res.status(500).json({ error: 'Failed to create league' });
    }
});

// Get user's leagues
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await db.query(`
      SELECT l.*, lm.team_name, lm.draft_position,
             (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as member_count
      FROM leagues l
      JOIN league_members lm ON l.id = lm.league_id
      WHERE lm.user_id = $1
      ORDER BY l.created_at DESC
    `, [userId]);

        res.json({ leagues: result.rows });
    } catch (error) {
        console.error('Get leagues error:', error);
        res.status(500).json({ error: 'Failed to fetch leagues' });
    }
});

// Get league details
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        // Verify user is member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Get league info
        const leagueResult = await db.query(
            'SELECT * FROM leagues WHERE id = $1',
            [leagueId]
        );

        if (leagueResult.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }

        res.json({ league: leagueResult.rows[0] });
    } catch (error) {
        console.error('Get league error:', error);
        res.status(500).json({ error: 'Failed to fetch league' });
    }
});

// Generate invite link
router.post('/:id/invite', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        // Verify user is member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Check if league is full (max 12)
        const countResult = await db.query(
            'SELECT max_players, (SELECT COUNT(*) FROM league_members WHERE league_id = $1) as current_count FROM leagues WHERE id = $1',
            [leagueId]
        );

        const { max_players, current_count } = countResult.rows[0];

        if (parseInt(current_count) >= parseInt(max_players)) {
            return res.status(400).json({ error: 'League is full (12 players max)' });
        }

        // Generate secure token
        const token = crypto.randomBytes(32).toString('hex');

        // Create or reuse existing invite
        await db.query(
            'INSERT INTO league_invites (league_id, token, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [leagueId, token, userId]
        );

        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${token}`;

        res.json({
            message: 'Invite link generated',
            inviteUrl,
            token
        });
    } catch (error) {
        console.error('Generate invite error:', error);
        res.status(500).json({ error: 'Failed to generate invite' });
    }
});

// Join league via invite token
router.post('/join/:token', authenticateToken, async (req, res) => {
    try {
        const token = req.params.token;
        const userId = req.user.userId;
        const username = req.user.username;

        // Get invite
        const inviteResult = await db.query(
            'SELECT * FROM league_invites WHERE token = $1 AND expires_at > NOW()',
            [token]
        );

        if (inviteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid or expired invite link' });
        }

        const invite = inviteResult.rows[0];

        // Check if already member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [invite.league_id, userId]
        );

        if (memberCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Already a member of this league' });
        }

        // Check if draft has started
        const leagueResult = await db.query(
            'SELECT max_players, draft_started, (SELECT COUNT(*) FROM league_members WHERE league_id = $1) as current_count FROM leagues WHERE id = $1',
            [invite.league_id]
        );

        const { max_players, draft_started, current_count } = leagueResult.rows[0];

        if (draft_started) {
            return res.status(400).json({ error: 'Cannot join - draft has already started' });
        }

        if (parseInt(current_count) >= parseInt(max_players)) {
            return res.status(400).json({ error: 'League is full (12 players max)' });
        }

        // Add member with default Fantasy Corp name
        const nextPosition = parseInt(current_count) + 1;
        await db.query(
            'INSERT INTO league_members (league_id, user_id, team_name, draft_position) VALUES ($1, $2, $3, $4)',
            [invite.league_id, userId, `${username}'s Fantasy Corp`, nextPosition]
        );

        // Update invite usage
        await db.query(
            'UPDATE league_invites SET used_count = used_count + 1 WHERE id = $1',
            [invite.id]
        );

        res.json({
            message: 'Successfully joined league',
            leagueId: invite.league_id
        });
    } catch (error) {
        console.error('Join league error:', error);
        res.status(500).json({ error: 'Failed to join league' });
    }
});

// Get league members
router.get('/:id/members', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        // Verify user is member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Get members
        const result = await db.query(`
      SELECT lm.*, u.username, u.email, u.profile_picture_url
      FROM league_members lm
      JOIN users u ON lm.user_id = u.id
      WHERE lm.league_id = $1
      ORDER BY lm.draft_position
    `, [leagueId]);

        res.json({ members: result.rows });
    } catch (error) {
        console.error('Get members error:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

module.exports = router;

// Leave league
router.post('/:id/leave', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        // Verify user is member
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Not a member of this league' });
        }

        // Delete all draft picks for this user in this league
        await db.query(
            'DELETE FROM draft_picks WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        // Remove from league members
        await db.query(
            'DELETE FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        res.json({ message: 'Successfully left league' });
    } catch (error) {
        console.error('Leave league error:', error);
        res.status(500).json({ error: 'Failed to leave league' });
    }
});

module.exports = router;
