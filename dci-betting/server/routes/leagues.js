const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// ── Helpers ────────────────────────────────────────────────────────────────

// Drop expired kick rows lazily on every invite-join attempt.
async function purgeExpiredKicks() {
    try {
        await db.query("DELETE FROM league_kicks WHERE kicked_at < NOW() - INTERVAL '60 seconds'");
    } catch (e) {
        // Don't block the request if cleanup fails — the active check still works
        console.warn('[leagues] purge-expired-kicks failed:', e.message);
    }
}

// Returns the user's current league_id if any, else null.
async function currentLeagueIdFor(userId) {
    const r = await db.query(
        'SELECT league_id FROM league_members WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return r.rows[0]?.league_id || null;
}

// Atomically wipe a user's footprint in a league within a transaction client.
async function removeUserFromLeague(client, leagueId, userId) {
    await client.query('DELETE FROM draft_picks WHERE league_id = $1 AND user_id = $2', [leagueId, userId]);
    await client.query('DELETE FROM draft_sessions WHERE league_id = $1 AND user_id = $2', [leagueId, userId]);
    await client.query('DELETE FROM league_members WHERE league_id = $1 AND user_id = $2', [leagueId, userId]);
}

// ── Create a new league ────────────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.user.userId;

        if (!name || name.length < 3 || name.length > 100) {
            return res.status(400).json({ error: 'League name must be between 3 and 100 characters' });
        }

        // One-league-per-user enforcement
        const existing = await currentLeagueIdFor(userId);
        if (existing) {
            return res.status(400).json({
                error: 'You are already in a league. Leave your current league before creating a new one.'
            });
        }

        const result = await db.query(
            'INSERT INTO leagues (name, creator_id, max_players, min_players) VALUES ($1, $2, 12, 4) RETURNING *',
            [name, userId]
        );
        const league = result.rows[0];

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
        if (error.code === '23505') {
            return res.status(400).json({
                error: 'You are already in a league. Leave your current league before creating a new one.'
            });
        }
        res.status(500).json({ error: 'Failed to create league' });
    }
});

// ── Get user's leagues ─────────────────────────────────────────────────────
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

// ── Get league details ─────────────────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        const leagueResult = await db.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
        if (leagueResult.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        res.json({ league: leagueResult.rows[0] });
    } catch (error) {
        console.error('Get league error:', error);
        res.status(500).json({ error: 'Failed to fetch league' });
    }
});

// ── Generate invite link ───────────────────────────────────────────────────
router.post('/:id/invite', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

        // Cannot create invite for a creator-less league (created_by would be orphaned
        // and there's no one to manage the league).
        const leagueRow = await db.query('SELECT creator_id FROM leagues WHERE id = $1', [leagueId]);
        if (!leagueRow.rows[0]?.creator_id) {
            return res.status(400).json({
                error: 'This league has no creator. An admin must assign a creator before invites can be generated.'
            });
        }

        const countResult = await db.query(
            'SELECT max_players, (SELECT COUNT(*) FROM league_members WHERE league_id = $1) as current_count FROM leagues WHERE id = $1',
            [leagueId]
        );
        const { max_players, current_count } = countResult.rows[0];
        if (parseInt(current_count) >= parseInt(max_players)) {
            return res.status(400).json({ error: 'League is full (12 players max)' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await db.query(
            'INSERT INTO league_invites (league_id, token, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [leagueId, token, userId]
        );
        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${token}`;
        res.json({ message: 'Invite link generated', inviteUrl, token });
    } catch (error) {
        console.error('Generate invite error:', error);
        res.status(500).json({ error: 'Failed to generate invite' });
    }
});

// ── Join league via invite token ───────────────────────────────────────────
router.post('/join/:token', authenticateToken, async (req, res) => {
    try {
        const token = req.params.token;
        const userId = req.user.userId;
        const username = req.user.username;

        await purgeExpiredKicks();

        const inviteResult = await db.query(
            'SELECT * FROM league_invites WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        if (inviteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid or expired invite link' });
        }
        const invite = inviteResult.rows[0];

        // Already a member of THIS league? Bounce them in.
        const sameLeagueCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [invite.league_id, userId]
        );
        if (sameLeagueCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Already a member of this league' });
        }

        // One-league-per-user enforcement
        const otherLeague = await currentLeagueIdFor(userId);
        if (otherLeague) {
            return res.status(400).json({
                error: 'You are already in a league. Leave your current league before joining another.'
            });
        }

        // 60s kick cooldown for THIS specific (user, league)
        const cooldown = await db.query(
            "SELECT 1 FROM league_kicks WHERE league_id = $1 AND user_id = $2 AND kicked_at > NOW() - INTERVAL '60 seconds'",
            [invite.league_id, userId]
        );
        if (cooldown.rows.length > 0) {
            return res.status(400).json({ error: 'You were kicked from this league.' });
        }

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

        const nextPosition = parseInt(current_count) + 1;
        await db.query(
            'INSERT INTO league_members (league_id, user_id, team_name, draft_position) VALUES ($1, $2, $3, $4)',
            [invite.league_id, userId, `${username}'s Fantasy Corp`, nextPosition]
        );
        await db.query(
            'UPDATE league_invites SET used_count = used_count + 1 WHERE id = $1',
            [invite.id]
        );

        res.json({ message: 'Successfully joined league', leagueId: invite.league_id });
    } catch (error) {
        console.error('Join league error:', error);
        if (error.code === '23505') {
            return res.status(400).json({
                error: 'You are already in a league. Leave your current league before joining another.'
            });
        }
        res.status(500).json({ error: 'Failed to join league' });
    }
});

// ── Get league members ─────────────────────────────────────────────────────
router.get('/:id/members', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this league' });
        }

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

// ── Open draft lobby (creator only) ────────────────────────────────────────
router.post('/:id/open-lobby', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;
        const { turnTimer } = req.body;

        const leagueResult = await db.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
        if (leagueResult.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        const league = leagueResult.rows[0];

        if (league.creator_id === null) {
            return res.status(400).json({
                error: 'This league has no creator. An admin must assign a creator before a draft can start.'
            });
        }
        if (league.creator_id !== userId) {
            return res.status(403).json({ error: 'Only the league creator can open the lobby' });
        }
        if (league.draft_started) {
            return res.status(400).json({ error: 'Draft has already started' });
        }
        if (league.draft_completed) {
            return res.status(400).json({ error: 'Draft has already completed' });
        }

        const timerValue = (turnTimer && parseInt(turnTimer) > 0) ? parseInt(turnTimer) : null;
        const updated = await db.query(
            'UPDATE leagues SET draft_lobby_open = TRUE, turn_timer_seconds = $1 WHERE id = $2 RETURNING *',
            [timerValue, leagueId]
        );

        await db.query('DELETE FROM draft_sessions WHERE league_id = $1', [leagueId]);
        await db.query(`
            INSERT INTO draft_sessions (league_id, user_id, is_connected, is_ready, last_heartbeat)
            SELECT $1, user_id, false, false, NOW() FROM league_members WHERE league_id = $1
        `, [leagueId]);

        res.json({ message: 'Lobby opened', league: updated.rows[0] });
    } catch (error) {
        console.error('Open lobby error:', error);
        res.status(500).json({ error: 'Failed to open lobby' });
    }
});

// ── Leave league ───────────────────────────────────────────────────────────
// Regular members only. Creator must use /transfer or DELETE / (dissolve).
router.post('/:id/leave', authenticateToken, async (req, res) => {
    try {
        const leagueId = req.params.id;
        const userId = req.user.userId;

        const leagueRow = await db.query(
            'SELECT creator_id, draft_started, draft_completed, name FROM leagues WHERE id = $1',
            [leagueId]
        );
        if (leagueRow.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        const league = leagueRow.rows[0];

        const memberCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Not a member of this league' });
        }

        if (league.draft_started && !league.draft_completed) {
            return res.status(403).json({ error: 'Cannot leave during an active draft.' });
        }

        if (league.creator_id === userId) {
            return res.status(403).json({
                error: 'As league creator, you must transfer ownership or dissolve the league.'
            });
        }

        await db.transaction(async (client) => {
            await removeUserFromLeague(client, leagueId, userId);
        });

        // Broadcast to remaining members (and force kick the user's socket
        // out of the league room in case they were on the draft page).
        const io = req.app.get('io');
        if (io) {
            io.to(`league-${leagueId}`).emit('player-left', { userId });
            const sockets = await io.in(`user-${userId}`).fetchSockets();
            for (const s of sockets) s.leave(`league-${leagueId}`);
        }

        res.json({ message: 'Successfully left league' });
    } catch (error) {
        console.error('Leave league error:', error);
        res.status(500).json({ error: 'Failed to leave league' });
    }
});

// ── Kick member ────────────────────────────────────────────────────────────
// Creator OR admin. Blocked during active draft.
router.post('/:id/kick', authenticateToken, async (req, res) => {
    try {
        const leagueId = parseInt(req.params.id);
        const callerId = req.user.userId;
        const targetUserId = parseInt(req.body.userId);

        if (!targetUserId || isNaN(targetUserId)) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const leagueRow = await db.query(
            'SELECT creator_id, draft_started, draft_completed, name FROM leagues WHERE id = $1',
            [leagueId]
        );
        if (leagueRow.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        const league = leagueRow.rows[0];

        // Authorization: creator or admin
        const callerRow = await db.query(
            'SELECT is_admin FROM users WHERE id = $1',
            [callerId]
        );
        const isAdmin = callerRow.rows[0]?.is_admin === true;
        const isCreator = league.creator_id === callerId;
        if (!isCreator && !isAdmin) {
            return res.status(403).json({ error: 'Only the league creator or an admin can kick members.' });
        }

        if (targetUserId === callerId) {
            return res.status(400).json({ error: 'You cannot kick yourself. Use Leave League instead.' });
        }

        // Creator cannot kick themselves AND cannot kick anyone via this endpoint
        // if they are themselves the target. Admins can kick the creator.
        if (targetUserId === league.creator_id && !isAdmin) {
            return res.status(400).json({ error: 'The league creator cannot be kicked by other members.' });
        }

        if (league.draft_started && !league.draft_completed) {
            return res.status(403).json({ error: 'Cannot kick during an active draft.' });
        }

        const targetCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, targetUserId]
        );
        if (targetCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Target user is not a member of this league' });
        }

        const wasCreator = (targetUserId === league.creator_id);

        await db.transaction(async (client) => {
            await removeUserFromLeague(client, leagueId, targetUserId);
            // Record cooldown — upsert kicked_at to NOW()
            await client.query(`
                INSERT INTO league_kicks (league_id, user_id, kicked_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (league_id, user_id) DO UPDATE SET kicked_at = NOW()
            `, [leagueId, targetUserId]);
            // If admin kicked the creator, the league becomes creator-less
            if (wasCreator) {
                await client.query('UPDATE leagues SET creator_id = NULL WHERE id = $1', [leagueId]);
            }
        });

        const io = req.app.get('io');
        if (io) {
            // Tell the kicked user (across all their tabs)
            io.to(`user-${targetUserId}`).emit('you-were-kicked', {
                leagueId,
                leagueName: league.name
            });
            // Force them out of the league room and inform remaining members
            const sockets = await io.in(`user-${targetUserId}`).fetchSockets();
            for (const s of sockets) s.leave(`league-${leagueId}`);
            io.to(`league-${leagueId}`).emit('player-kicked', { userId: targetUserId });
            // If the creator was removed, also notify the room so member UIs refresh state
            if (wasCreator) {
                io.to(`league-${leagueId}`).emit('creator-changed', { newCreatorId: null });
            }
        }

        res.json({ message: 'Member kicked' });
    } catch (error) {
        console.error('Kick member error:', error);
        res.status(500).json({ error: 'Failed to kick member' });
    }
});

// ── Transfer ownership (creator only) ──────────────────────────────────────
// Old creator stays in the league as a regular member.
router.post('/:id/transfer', authenticateToken, async (req, res) => {
    try {
        const leagueId = parseInt(req.params.id);
        const callerId = req.user.userId;
        const newCreatorId = parseInt(req.body.newCreatorId);

        if (!newCreatorId || isNaN(newCreatorId)) {
            return res.status(400).json({ error: 'newCreatorId is required' });
        }
        if (newCreatorId === callerId) {
            return res.status(400).json({ error: 'You are already the creator.' });
        }

        const leagueRow = await db.query(
            'SELECT creator_id, draft_started, draft_completed FROM leagues WHERE id = $1',
            [leagueId]
        );
        if (leagueRow.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        const league = leagueRow.rows[0];
        if (league.creator_id !== callerId) {
            return res.status(403).json({ error: 'Only the league creator can transfer ownership.' });
        }
        if (league.draft_started && !league.draft_completed) {
            return res.status(403).json({ error: 'Cannot transfer ownership during an active draft.' });
        }

        const targetCheck = await db.query(
            'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
            [leagueId, newCreatorId]
        );
        if (targetCheck.rows.length === 0) {
            return res.status(400).json({ error: 'New creator must be a current member of this league.' });
        }

        await db.query('UPDATE leagues SET creator_id = $1 WHERE id = $2', [newCreatorId, leagueId]);

        const io = req.app.get('io');
        if (io) {
            io.to(`league-${leagueId}`).emit('creator-changed', { newCreatorId });
        }

        res.json({ message: 'Ownership transferred' });
    } catch (error) {
        console.error('Transfer ownership error:', error);
        res.status(500).json({ error: 'Failed to transfer ownership' });
    }
});

// ── Dissolve league (creator only, type-to-confirm) ────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const leagueId = parseInt(req.params.id);
        const callerId = req.user.userId;
        const { confirmName } = req.body || {};

        const leagueRow = await db.query(
            'SELECT creator_id, name, draft_started, draft_completed FROM leagues WHERE id = $1',
            [leagueId]
        );
        if (leagueRow.rows.length === 0) {
            return res.status(404).json({ error: 'League not found' });
        }
        const league = leagueRow.rows[0];

        if (league.creator_id !== callerId) {
            return res.status(403).json({ error: 'Only the league creator can dissolve the league.' });
        }
        if (league.draft_started && !league.draft_completed) {
            return res.status(403).json({ error: 'Cannot dissolve the league during an active draft.' });
        }
        if (confirmName !== league.name) {
            return res.status(400).json({ error: 'Confirmation name does not match the league name.' });
        }

        // Tell members before the DB rows are gone
        const io = req.app.get('io');
        if (io) {
            io.to(`league-${leagueId}`).emit('league-dissolved', { leagueId, leagueName: league.name });
        }

        // Cascades remove league_members, draft_picks, draft_sessions, league_invites, league_kicks
        await db.query('DELETE FROM leagues WHERE id = $1', [leagueId]);

        res.json({ message: 'League dissolved' });
    } catch (error) {
        console.error('Dissolve league error:', error);
        res.status(500).json({ error: 'Failed to dissolve league' });
    }
});

module.exports = router;
