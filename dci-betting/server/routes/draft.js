const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// Record a draft pick
router.post('/pick', authenticateToken, async (req, res) => {
    try {
        const { leagueId, captionId, sectionType, pickNumber } = req.body;
        const userId = req.user.userId;

        // Verify user is member of league
        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Check if caption already drafted
        const existingPick = await db.query(
            'SELECT 1 FROM draft_picks WHERE league_id = $1 AND caption_id = $2',
            [leagueId, captionId]
        );

        if (existingPick.rows.length > 0) {
            return res.status(400).json({ error: 'Caption already drafted' });
        }

        // Record pick
        const result = await db.query(
            'INSERT INTO draft_picks (league_id, user_id, caption_id, section_type, pick_number) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [leagueId, userId, captionId, sectionType, pickNumber]
        );

        res.json({
            message: 'Pick recorded',
            pick: result.rows[0]
        });
    } catch (error) {
        console.error('Draft pick error:', error);
        res.status(500).json({ error: 'Failed to record pick' });
    }
});

// Get all draft picks for a league
router.get('/:leagueId/picks', authenticateToken, async (req, res) => {
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

        // Get all picks
        const result = await db.query(
            'SELECT dp.*, u.username FROM draft_picks dp JOIN users u ON dp.user_id = u.id WHERE dp.league_id = $1 ORDER BY dp.pick_number',
            [leagueId]
        );

        res.json({ picks: result.rows });
    } catch (error) {
        console.error('Get picks error:', error);
        res.status(500).json({ error: 'Failed to fetch picks' });
    }
});

// Get current draft turn state
router.get('/:leagueId/state', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.leagueId;
        const userId = req.user.userId;

        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        const league = await db.query(
            'SELECT current_draft_turn, turn_timer_seconds FROM leagues WHERE id = $1',
            [leagueId]
        );
        if (league.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }

        const turnIndex = league.rows[0].current_draft_turn || 0;

        const members = await db.query(
            'SELECT user_id FROM league_members WHERE league_id = $1 ORDER BY draft_position',
            [leagueId]
        );
        const draftOrder = members.rows.map(r => r.user_id);
        const playerCount = draftOrder.length;
        const currentTurnUserId = playerCount > 0 ? draftOrder[turnIndex % playerCount] : null;

        res.json({
            currentTurnUserId,
            currentTurnIndex: turnIndex,
            playerCount,
            round: playerCount > 0 ? Math.floor(turnIndex / playerCount) + 1 : 1,
            pickInRound: playerCount > 0 ? (turnIndex % playerCount) + 1 : 1
        });
    } catch (error) {
        console.error('Get draft state error:', error);
        res.status(500).json({ error: 'Failed to fetch draft state' });
    }
});

// Get available captions for draft
router.get('/:leagueId/available', authenticateToken, async (req, res) => {
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

        // Get drafted caption IDs
        const draftedResult = await db.query(
            'SELECT caption_id FROM draft_picks WHERE league_id = $1',
            [leagueId]
        );

        const draftedIds = draftedResult.rows.map(row => row.caption_id);

        res.json({
            draftedCaptions: draftedIds
        });
    } catch (error) {
        console.error('Get available error:', error);
        res.status(500).json({ error: 'Failed to fetch available captions' });
    }
});

module.exports = router;
