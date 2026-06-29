const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

function setupDraftSocket(server, db) {
    const io = socketIo(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            credentials: true
        }
    });

    // Track active draft timers and disconnect grace timers
    const draftTimers = new Map();
    const disconnectTimers = new Map();

    // ── Auth middleware ───────────────────────────────────────────────────────
    // JWT lives in an httpOnly cookie — parse it from the handshake headers
    io.use(async (socket, next) => {
        try {
            const cookieStr = socket.handshake.headers.cookie || '';
            const match = cookieStr.match(/(?:^|;\s*)token=([^;]+)/);
            const token = match ? decodeURIComponent(match[1]) : null;

            if (!token) return next(new Error('No auth token'));

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            next();
        } catch (error) {
            next(new Error('Authentication failed'));
        }
    });

    // ── Connection handler ────────────────────────────────────────────────────
    io.on('connection', (socket) => {
        console.log(`[Socket] ${socket.username} (${socket.userId}) connected`);

        // Personal room — lets HTTP routes target this user across all their
        // tabs/devices via io.to(`user-${userId}`).emit(...)
        socket.join(`user-${socket.userId}`);

        // ── join-lobby ────────────────────────────────────────────────────────
        socket.on('join-lobby', async (leagueId) => {
            try {
                const memberCheck = await db.query(
                    'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
                    [leagueId, socket.userId]
                );
                if (memberCheck.rows.length === 0) {
                    socket.emit('error', { message: 'Not a member of this league' });
                    return;
                }

                socket.join(`league-${leagueId}`);
                socket.currentLeagueId = leagueId;

                await db.query(`
                    INSERT INTO draft_sessions (league_id, user_id, is_connected, is_ready, last_heartbeat)
                    VALUES ($1, $2, true, false, NOW())
                    ON CONFLICT (league_id, user_id)
                    DO UPDATE SET is_connected = true, last_heartbeat = NOW()
                `, [leagueId, socket.userId]);

                // If reconnecting during grace period, cancel the disconnect timer
                const graceKey = `${leagueId}-${socket.userId}`;
                if (disconnectTimers.has(graceKey)) {
                    clearInterval(disconnectTimers.get(graceKey));
                    disconnectTimers.delete(graceKey);
                    io.to(`league-${leagueId}`).emit('draft-resumed', {
                        userId: socket.userId,
                        username: socket.username
                    });
                    console.log(`[Socket] ${socket.username} reconnected in time — draft resumed`);
                }

                io.to(`league-${leagueId}`).emit('player-joined', {
                    userId: socket.userId,
                    username: socket.username
                });

                const lobbyState = await getLobbyState(db, leagueId);
                io.to(`league-${leagueId}`).emit('lobby-state', lobbyState);

                // If a draft is already in progress, send the current turn to the joining socket
                // so their caption grid enables correctly and the turn timer shows
                const leagueRow = await db.query(
                    'SELECT draft_started, draft_completed, current_draft_turn FROM leagues WHERE id = $1',
                    [leagueId]
                );
                const lr = leagueRow.rows[0];
                if (lr && lr.draft_started && !lr.draft_completed) {
                    const turnIndex = lr.current_draft_turn;
                    const draftOrder = await getDraftOrder(db, leagueId);
                    if (draftOrder.length > 0) {
                        const playerCount = draftOrder.length;
                        const currentUserId = draftOrder[turnIndex % playerCount];
                        const nextUserId = draftOrder[(turnIndex + 1) % playerCount];
                        const round = Math.floor(turnIndex / playerCount);
                        socket.emit('turn-changed', {
                            currentUserId,
                            nextUserId,
                            turnIndex,
                            round: round + 1,
                            pickInRound: (turnIndex % playerCount) + 1,
                            totalPlayers: playerCount
                        });
                    }
                }

                console.log(`[Socket] ${socket.username} joined lobby for league ${leagueId}`);
            } catch (error) {
                console.error('[Socket] join-lobby error:', error);
                socket.emit('error', { message: 'Failed to join lobby' });
            }
        });

        // ── update-team-name ──────────────────────────────────────────────────
        socket.on('update-team-name', async ({ leagueId, teamName }) => {
            try {
                if (!teamName || teamName.trim().length < 2 || teamName.trim().length > 50) {
                    socket.emit('error', { message: 'Team name must be 2–50 characters' });
                    return;
                }
                await db.query(
                    'UPDATE league_members SET team_name = $1 WHERE league_id = $2 AND user_id = $3',
                    [teamName.trim(), leagueId, socket.userId]
                );
                const lobbyState = await getLobbyState(db, leagueId);
                io.to(`league-${leagueId}`).emit('lobby-state', lobbyState);
            } catch (error) {
                console.error('[Socket] update-team-name error:', error);
                socket.emit('error', { message: 'Failed to update team name' });
            }
        });

        // ── ready-up ──────────────────────────────────────────────────────────
        socket.on('ready-up', async (leagueId) => {
            try {
                await db.query(`
                    UPDATE draft_sessions
                    SET is_ready = NOT is_ready
                    WHERE league_id = $1 AND user_id = $2
                `, [leagueId, socket.userId]);

                const session = await db.query(
                    'SELECT is_ready FROM draft_sessions WHERE league_id = $1 AND user_id = $2',
                    [leagueId, socket.userId]
                );
                const isReady = session.rows[0]?.is_ready || false;

                io.to(`league-${leagueId}`).emit('player-ready-changed', {
                    userId: socket.userId,
                    username: socket.username,
                    isReady
                });

                const lobbyState = await getLobbyState(db, leagueId);
                io.to(`league-${leagueId}`).emit('lobby-state', lobbyState);

                console.log(`[Socket] ${socket.username} ${isReady ? 'ready' : 'not ready'} in league ${leagueId}`);
            } catch (error) {
                console.error('[Socket] ready-up error:', error);
                socket.emit('error', { message: 'Failed to update ready status' });
            }
        });

        // ── start-draft ───────────────────────────────────────────────────────
        socket.on('start-draft', async (data) => {
            try {
                const { leagueId, turnTimer } = data;

                const leagueCheck = await db.query(
                    'SELECT creator_id FROM leagues WHERE id = $1',
                    [leagueId]
                );
                if (leagueCheck.rows.length === 0) {
                    socket.emit('error', { message: 'League not found' });
                    return;
                }
                if (leagueCheck.rows[0].creator_id === null) {
                    socket.emit('error', { message: 'This league has no creator. An admin must assign a creator before a draft can start.' });
                    return;
                }
                if (leagueCheck.rows[0].creator_id !== socket.userId) {
                    socket.emit('error', { message: 'Only the league creator can start the draft' });
                    return;
                }

                const lobbyState = await getLobbyState(db, leagueId);
                if (!lobbyState.allReady || !lobbyState.allConnected) {
                    socket.emit('error', { message: 'Not all players are connected and ready' });
                    return;
                }

                // Randomly shuffle draft positions
                const memberIds = await getDraftOrder(db, leagueId);
                const shuffled = [...memberIds].sort(() => Math.random() - 0.5);
                for (let i = 0; i < shuffled.length; i++) {
                    await db.query(
                        'UPDATE league_members SET draft_position = $1 WHERE league_id = $2 AND user_id = $3',
                        [i + 1, leagueId, shuffled[i]]
                    );
                }

                await db.query(`
                    UPDATE leagues
                    SET draft_started = true,
                        draft_lobby_open = false,
                        turn_timer_seconds = $2,
                        current_draft_turn = 0
                    WHERE id = $1
                `, [leagueId, turnTimer || null]);

                io.to(`league-${leagueId}`).emit('draft-started', {
                    turnTimer,
                    draftOrder: shuffled
                });

                // Start first turn — pass playerCount so round 1 is fully unlimited
                await startTurn(io, db, draftTimers, leagueId, 0, shuffled.length);

                console.log(`[Socket] Draft started for league ${leagueId} | timer: ${turnTimer || 'unlimited'} | players: ${shuffled.length}`);
            } catch (error) {
                console.error('[Socket] start-draft error:', error);
                socket.emit('error', { message: 'Failed to start draft' });
            }
        });

        // ── make-pick ─────────────────────────────────────────────────────────
        socket.on('make-pick', async (data) => {
            try {
                const { leagueId, captionId } = data;

                const league = await db.query(
                    'SELECT current_draft_turn FROM leagues WHERE id = $1',
                    [leagueId]
                );
                const turnIndex = league.rows[0].current_draft_turn;
                const draftOrder = await getDraftOrder(db, leagueId);
                const currentTurnUserId = draftOrder[turnIndex % draftOrder.length];

                if (currentTurnUserId !== socket.userId) {
                    socket.emit('error', { message: 'Not your turn' });
                    return;
                }

                // Check caption not already drafted
                const existing = await db.query(
                    'SELECT 1 FROM draft_picks WHERE league_id = $1 AND caption_id = $2',
                    [leagueId, captionId]
                );
                if (existing.rows.length > 0) {
                    socket.emit('error', { message: 'Caption already drafted' });
                    return;
                }

                const section = deriveSectionFromCaptionId(captionId);

                // Check user doesn't already have a pick for this section
                const sectionCheck = await db.query(
                    'SELECT 1 FROM draft_picks WHERE league_id = $1 AND user_id = $2 AND section_type = $3',
                    [leagueId, socket.userId, section]
                );
                if (sectionCheck.rows.length > 0) {
                    socket.emit('error', { message: `You already have a pick for ${section}` });
                    return;
                }

                await db.query(`
                    INSERT INTO draft_picks (league_id, user_id, caption_id, section_type, pick_number)
                    VALUES ($1, $2, $3, $4, $5)
                `, [leagueId, socket.userId, captionId, section, turnIndex]);

                stopTurnTimer(leagueId, draftTimers);

                io.to(`league-${leagueId}`).emit('pick-made', {
                    userId: socket.userId,
                    username: socket.username,
                    captionId,
                    section,
                    pickNumber: turnIndex
                });

                const totalPicks = draftOrder.length * 8;
                const newTurn = turnIndex + 1;

                if (newTurn < totalPicks) {
                    await db.query(
                        'UPDATE leagues SET current_draft_turn = $2 WHERE id = $1',
                        [leagueId, newTurn]
                    );
                    await startTurn(io, db, draftTimers, leagueId, newTurn, draftOrder.length);
                } else {
                    await db.query(
                        'UPDATE leagues SET draft_completed = true WHERE id = $1',
                        [leagueId]
                    );
                    io.to(`league-${leagueId}`).emit('draft-completed');
                    console.log(`[Socket] Draft completed for league ${leagueId}`);
                }

                console.log(`[Socket] ${socket.username} picked ${captionId} (pick #${turnIndex}) in league ${leagueId}`);
            } catch (error) {
                console.error('[Socket] make-pick error:', error);
                socket.emit('error', { message: 'Failed to make pick' });
            }
        });

        // ── heartbeat ─────────────────────────────────────────────────────────
        socket.on('heartbeat', async (leagueId) => {
            try {
                await db.query(`
                    UPDATE draft_sessions SET last_heartbeat = NOW()
                    WHERE league_id = $1 AND user_id = $2
                `, [leagueId, socket.userId]);
            } catch (error) {
                console.error('[Socket] heartbeat error:', error);
            }
        });

        // ── disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', async () => {
            try {
                const leagueId = socket.currentLeagueId;
                if (!leagueId) return;

                await db.query(`
                    UPDATE draft_sessions SET is_connected = false
                    WHERE league_id = $1 AND user_id = $2
                `, [leagueId, socket.userId]);

                io.to(`league-${leagueId}`).emit('player-disconnected', {
                    userId: socket.userId,
                    username: socket.username
                });

                const lobbyState = await getLobbyState(db, leagueId);
                io.to(`league-${leagueId}`).emit('lobby-state', lobbyState);

                console.log(`[Socket] ${socket.username} disconnected from league ${leagueId}`);

                // If ALL players are now disconnected, reset the draft so they start fresh
                // (but never wipe a completed draft — picks must persist after everyone leaves)
                const allSessions = await db.query(
                    'SELECT is_connected FROM draft_sessions WHERE league_id = $1',
                    [leagueId]
                );
                const allGone = allSessions.rows.length > 0 && allSessions.rows.every(s => !s.is_connected);
                if (allGone) {
                    const leagueCheck = await db.query(
                        'SELECT draft_completed FROM leagues WHERE id = $1',
                        [leagueId]
                    );
                    if (leagueCheck.rows[0]?.draft_completed) {
                        console.log(`[Socket] All players left league ${leagueId} — draft complete, preserving picks`);
                        return;
                    }
                    // Stop all active timers for this league
                    stopTurnTimer(leagueId, draftTimers);
                    for (const [key, timer] of disconnectTimers.entries()) {
                        if (key.startsWith(`${leagueId}-`)) {
                            clearInterval(timer);
                            disconnectTimers.delete(key);
                        }
                    }
                    // Wipe picks and reset league state (only for incomplete/abandoned drafts)
                    await db.query('DELETE FROM draft_picks WHERE league_id = $1', [leagueId]);
                    await db.query('DELETE FROM draft_sessions WHERE league_id = $1', [leagueId]);
                    await db.query(`
                        UPDATE leagues
                        SET draft_started = false, draft_lobby_open = false, draft_completed = false,
                            current_draft_turn = 0, turn_timer_seconds = NULL
                        WHERE id = $1
                    `, [leagueId]);
                    console.log(`[Socket] All players left league ${leagueId} — draft reset`);
                    return;
                }

                // Check if it's this player's turn — if so, start 2-min grace period
                const league = await db.query(
                    'SELECT current_draft_turn, draft_started, draft_completed FROM leagues WHERE id = $1',
                    [leagueId]
                );
                if (!league.rows[0] || !league.rows[0].draft_started || league.rows[0].draft_completed) return;

                const turnIndex = league.rows[0].current_draft_turn;
                const draftOrder = await getDraftOrder(db, leagueId);
                const activeUserId = draftOrder[turnIndex % draftOrder.length];

                if (activeUserId !== socket.userId) return; // Not their turn — just mark disconnected, pause naturally

                // It IS their turn — start 2-minute grace countdown
                io.to(`league-${leagueId}`).emit('draft-paused', {
                    reason: 'Current player disconnected',
                    userId: socket.userId,
                    username: socket.username
                });

                let remaining = 120;
                const graceKey = `${leagueId}-${socket.userId}`;

                const graceTimer = setInterval(async () => {
                    remaining--;
                    io.to(`league-${leagueId}`).emit('reconnect-countdown', {
                        userId: socket.userId,
                        username: socket.username,
                        seconds: remaining
                    });

                    if (remaining <= 0) {
                        clearInterval(graceTimer);
                        disconnectTimers.delete(graceKey);
                        console.log(`[Socket] Grace period expired for ${socket.username} — auto-picking`);
                        await autoPickCaption(io, db, draftTimers, leagueId, turnIndex, draftOrder);
                    }
                }, 1000);

                disconnectTimers.set(graceKey, graceTimer);
            } catch (error) {
                console.error('[Socket] disconnect error:', error);
            }
        });
    });

    return io;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getLobbyState(db, leagueId) {
    const sessions = await db.query(`
        SELECT ds.user_id, u.username, ds.is_connected, ds.is_ready, lm.team_name
        FROM draft_sessions ds
        JOIN users u ON ds.user_id = u.id
        JOIN league_members lm ON ds.user_id = lm.user_id AND ds.league_id = lm.league_id
        WHERE ds.league_id = $1
        ORDER BY lm.draft_position
    `, [leagueId]);

    const league = await db.query(
        'SELECT max_players, min_players, creator_id FROM leagues WHERE id = $1',
        [leagueId]
    );

    const players = sessions.rows.map(row => ({
        userId: row.user_id,
        username: row.username,
        teamName: row.team_name,
        isConnected: row.is_connected,
        isReady: row.is_ready
    }));

    const allConnected = players.length > 0 && players.every(p => p.isConnected);
    const allReady = players.length > 0 && players.every(p => p.isReady);
    const minPlayers = league.rows[0]?.min_players || 4;

    return {
        players,
        allConnected,
        allReady,
        canStart: players.length >= minPlayers && allConnected && allReady,
        creatorId: league.rows[0]?.creator_id,
        draftOrder: players.map(p => p.userId)
    };
}

async function getDraftOrder(db, leagueId) {
    const members = await db.query(`
        SELECT user_id FROM league_members
        WHERE league_id = $1
        ORDER BY draft_position
    `, [leagueId]);
    return members.rows.map(row => row.user_id);
}

// Round 1 = all picks where turnIndex < playerCount (unlimited time)
// Round 2+ = use the configured timer
async function startTurn(io, db, draftTimers, leagueId, turnIndex, playerCount) {
    const draftOrder = await getDraftOrder(db, leagueId);
    const currentUserId = draftOrder[turnIndex % draftOrder.length];
    const nextUserId = draftOrder[(turnIndex + 1) % draftOrder.length];

    // Check if current player is still connected
    const session = await db.query(
        'SELECT is_connected FROM draft_sessions WHERE league_id = $1 AND user_id = $2',
        [leagueId, currentUserId]
    );
    if (session.rows.length > 0 && !session.rows[0].is_connected) {
        io.to(`league-${leagueId}`).emit('draft-paused', {
            reason: 'Current player is disconnected',
            userId: currentUserId
        });
        return;
    }

    const round = Math.floor(turnIndex / playerCount); // 0-indexed round
    const isRoundOne = round === 0;

    io.to(`league-${leagueId}`).emit('turn-changed', {
        currentUserId,
        nextUserId,
        turnIndex,
        round: round + 1,
        pickInRound: (turnIndex % playerCount) + 1,
        totalPlayers: playerCount
    });

    if (isRoundOne) {
        // Entire round 1 is unlimited for all players
        io.to(`league-${leagueId}`).emit('timer-tick', 'unlimited');
    } else {
        const league = await db.query(
            'SELECT turn_timer_seconds FROM leagues WHERE id = $1',
            [leagueId]
        );
        const timerSeconds = league.rows[0]?.turn_timer_seconds;
        if (timerSeconds) {
            startTurnTimer(io, db, draftTimers, leagueId, timerSeconds, turnIndex, draftOrder, playerCount);
        } else {
            io.to(`league-${leagueId}`).emit('timer-tick', 'unlimited');
        }
    }
}

function startTurnTimer(io, db, draftTimers, leagueId, duration, turnIndex, draftOrder, playerCount) {
    let remaining = duration;

    const timerId = setInterval(async () => {
        remaining--;
        io.to(`league-${leagueId}`).emit('timer-tick', remaining);

        if (remaining <= 0) {
            clearInterval(timerId);
            draftTimers.delete(`${leagueId}-${turnIndex}`);
            await autoPickCaption(io, db, draftTimers, leagueId, turnIndex, draftOrder, playerCount);
        }
    }, 1000);

    draftTimers.set(`${leagueId}-${turnIndex}`, timerId);
}

function stopTurnTimer(leagueId, draftTimers) {
    for (const [key, timerId] of draftTimers.entries()) {
        if (key.startsWith(`${leagueId}-`)) {
            clearInterval(timerId);
            draftTimers.delete(key);
        }
    }
}

// Auto-pick the highest-scoring available caption for the current player
async function autoPickCaption(io, db, draftTimers, leagueId, turnIndex, draftOrder, playerCount) {
    const userId = draftOrder[turnIndex % draftOrder.length];

    // Caption list matching the frontend captions in app.js (20 corps × 8 captions = 160)
    const ALL_CAPTIONS = [
        // Blue Devils
        { id: 'bd-brass',               corps: 'Blue Devils',          section: 'Brass',              score: 0 },
        { id: 'bd-music-analysis',      corps: 'Blue Devils',          section: 'Music Analysis',     score: 0 },
        { id: 'bd-percussion',          corps: 'Blue Devils',          section: 'Percussion',         score: 0 },
        { id: 'bd-color-guard',         corps: 'Blue Devils',          section: 'Color Guard',        score: 0 },
        { id: 'bd-ge1',                 corps: 'Blue Devils',          section: 'General Effect 1',   score: 0 },
        { id: 'bd-ge2',                 corps: 'Blue Devils',          section: 'General Effect 2',   score: 0 },
        { id: 'bd-visual-proficiency',  corps: 'Blue Devils',          section: 'Visual Proficiency', score: 0 },
        { id: 'bd-visual-analysis',     corps: 'Blue Devils',          section: 'Visual Analysis',    score: 0 },
        // Santa Clara Vanguard
        { id: 'scv-brass',              corps: 'Santa Clara Vanguard', section: 'Brass',              score: 0 },
        { id: 'scv-music-analysis',     corps: 'Santa Clara Vanguard', section: 'Music Analysis',     score: 0 },
        { id: 'scv-percussion',         corps: 'Santa Clara Vanguard', section: 'Percussion',         score: 0 },
        { id: 'scv-color-guard',        corps: 'Santa Clara Vanguard', section: 'Color Guard',        score: 0 },
        { id: 'scv-ge1',                corps: 'Santa Clara Vanguard', section: 'General Effect 1',   score: 0 },
        { id: 'scv-ge2',                corps: 'Santa Clara Vanguard', section: 'General Effect 2',   score: 0 },
        { id: 'scv-visual-proficiency', corps: 'Santa Clara Vanguard', section: 'Visual Proficiency', score: 0 },
        { id: 'scv-visual-analysis',    corps: 'Santa Clara Vanguard', section: 'Visual Analysis',    score: 0 },
        // Bluecoats
        { id: 'bloo-brass',               corps: 'Bluecoats', section: 'Brass',              score: 0 },
        { id: 'bloo-music-analysis',      corps: 'Bluecoats', section: 'Music Analysis',     score: 0 },
        { id: 'bloo-percussion',          corps: 'Bluecoats', section: 'Percussion',         score: 0 },
        { id: 'bloo-color-guard',         corps: 'Bluecoats', section: 'Color Guard',        score: 0 },
        { id: 'bloo-ge1',                 corps: 'Bluecoats', section: 'General Effect 1',   score: 0 },
        { id: 'bloo-ge2',                 corps: 'Bluecoats', section: 'General Effect 2',   score: 0 },
        { id: 'bloo-visual-proficiency',  corps: 'Bluecoats', section: 'Visual Proficiency', score: 0 },
        { id: 'bloo-visual-analysis',     corps: 'Bluecoats', section: 'Visual Analysis',    score: 0 },
        // Carolina Crown
        { id: 'crown-brass',               corps: 'Carolina Crown', section: 'Brass',              score: 0 },
        { id: 'crown-music-analysis',      corps: 'Carolina Crown', section: 'Music Analysis',     score: 0 },
        { id: 'crown-percussion',          corps: 'Carolina Crown', section: 'Percussion',         score: 0 },
        { id: 'crown-color-guard',         corps: 'Carolina Crown', section: 'Color Guard',        score: 0 },
        { id: 'crown-ge1',                 corps: 'Carolina Crown', section: 'General Effect 1',   score: 0 },
        { id: 'crown-ge2',                 corps: 'Carolina Crown', section: 'General Effect 2',   score: 0 },
        { id: 'crown-visual-proficiency',  corps: 'Carolina Crown', section: 'Visual Proficiency', score: 0 },
        { id: 'crown-visual-analysis',     corps: 'Carolina Crown', section: 'Visual Analysis',    score: 0 },
        // The Cavaliers
        { id: 'cavs-brass',               corps: 'The Cavaliers', section: 'Brass',              score: 0 },
        { id: 'cavs-music-analysis',      corps: 'The Cavaliers', section: 'Music Analysis',     score: 0 },
        { id: 'cavs-percussion',          corps: 'The Cavaliers', section: 'Percussion',         score: 0 },
        { id: 'cavs-color-guard',         corps: 'The Cavaliers', section: 'Color Guard',        score: 0 },
        { id: 'cavs-ge1',                 corps: 'The Cavaliers', section: 'General Effect 1',   score: 0 },
        { id: 'cavs-ge2',                 corps: 'The Cavaliers', section: 'General Effect 2',   score: 0 },
        { id: 'cavs-visual-proficiency',  corps: 'The Cavaliers', section: 'Visual Proficiency', score: 0 },
        { id: 'cavs-visual-analysis',     corps: 'The Cavaliers', section: 'Visual Analysis',    score: 0 },
        // Boston Crusaders
        { id: 'bac-brass',               corps: 'Boston Crusaders', section: 'Brass',              score: 0 },
        { id: 'bac-music-analysis',      corps: 'Boston Crusaders', section: 'Music Analysis',     score: 0 },
        { id: 'bac-percussion',          corps: 'Boston Crusaders', section: 'Percussion',         score: 0 },
        { id: 'bac-color-guard',         corps: 'Boston Crusaders', section: 'Color Guard',        score: 0 },
        { id: 'bac-ge1',                 corps: 'Boston Crusaders', section: 'General Effect 1',   score: 0 },
        { id: 'bac-ge2',                 corps: 'Boston Crusaders', section: 'General Effect 2',   score: 0 },
        { id: 'bac-visual-proficiency',  corps: 'Boston Crusaders', section: 'Visual Proficiency', score: 0 },
        { id: 'bac-visual-analysis',     corps: 'Boston Crusaders', section: 'Visual Analysis',    score: 0 },
        // Phantom Regiment
        { id: 'pr-brass',               corps: 'Phantom Regiment', section: 'Brass',              score: 0 },
        { id: 'pr-music-analysis',      corps: 'Phantom Regiment', section: 'Music Analysis',     score: 0 },
        { id: 'pr-percussion',          corps: 'Phantom Regiment', section: 'Percussion',         score: 0 },
        { id: 'pr-color-guard',         corps: 'Phantom Regiment', section: 'Color Guard',        score: 0 },
        { id: 'pr-ge1',                 corps: 'Phantom Regiment', section: 'General Effect 1',   score: 0 },
        { id: 'pr-ge2',                 corps: 'Phantom Regiment', section: 'General Effect 2',   score: 0 },
        { id: 'pr-visual-proficiency',  corps: 'Phantom Regiment', section: 'Visual Proficiency', score: 0 },
        { id: 'pr-visual-analysis',     corps: 'Phantom Regiment', section: 'Visual Analysis',    score: 0 },
        // Blue Stars
        { id: 'bs-brass',               corps: 'Blue Stars', section: 'Brass',              score: 0 },
        { id: 'bs-music-analysis',      corps: 'Blue Stars', section: 'Music Analysis',     score: 0 },
        { id: 'bs-percussion',          corps: 'Blue Stars', section: 'Percussion',         score: 0 },
        { id: 'bs-color-guard',         corps: 'Blue Stars', section: 'Color Guard',        score: 0 },
        { id: 'bs-ge1',                 corps: 'Blue Stars', section: 'General Effect 1',   score: 0 },
        { id: 'bs-ge2',                 corps: 'Blue Stars', section: 'General Effect 2',   score: 0 },
        { id: 'bs-visual-proficiency',  corps: 'Blue Stars', section: 'Visual Proficiency', score: 0 },
        { id: 'bs-visual-analysis',     corps: 'Blue Stars', section: 'Visual Analysis',    score: 0 },
        // Madison Scouts
        { id: 'scouts-brass',               corps: 'Madison Scouts', section: 'Brass',              score: 0 },
        { id: 'scouts-music-analysis',      corps: 'Madison Scouts', section: 'Music Analysis',     score: 0 },
        { id: 'scouts-percussion',          corps: 'Madison Scouts', section: 'Percussion',         score: 0 },
        { id: 'scouts-color-guard',         corps: 'Madison Scouts', section: 'Color Guard',        score: 0 },
        { id: 'scouts-ge1',                 corps: 'Madison Scouts', section: 'General Effect 1',   score: 0 },
        { id: 'scouts-ge2',                 corps: 'Madison Scouts', section: 'General Effect 2',   score: 0 },
        { id: 'scouts-visual-proficiency',  corps: 'Madison Scouts', section: 'Visual Proficiency', score: 0 },
        { id: 'scouts-visual-analysis',     corps: 'Madison Scouts', section: 'Visual Analysis',    score: 0 },
        // Blue Knights
        { id: 'bk-brass',               corps: 'Blue Knights', section: 'Brass',              score: 0 },
        { id: 'bk-music-analysis',      corps: 'Blue Knights', section: 'Music Analysis',     score: 0 },
        { id: 'bk-percussion',          corps: 'Blue Knights', section: 'Percussion',         score: 0 },
        { id: 'bk-color-guard',         corps: 'Blue Knights', section: 'Color Guard',        score: 0 },
        { id: 'bk-ge1',                 corps: 'Blue Knights', section: 'General Effect 1',   score: 0 },
        { id: 'bk-ge2',                 corps: 'Blue Knights', section: 'General Effect 2',   score: 0 },
        { id: 'bk-visual-proficiency',  corps: 'Blue Knights', section: 'Visual Proficiency', score: 0 },
        { id: 'bk-visual-analysis',     corps: 'Blue Knights', section: 'Visual Analysis',    score: 0 },
        // Crossmen
        { id: 'cross-brass',               corps: 'Crossmen', section: 'Brass',              score: 0 },
        { id: 'cross-music-analysis',      corps: 'Crossmen', section: 'Music Analysis',     score: 0 },
        { id: 'cross-percussion',          corps: 'Crossmen', section: 'Percussion',         score: 0 },
        { id: 'cross-color-guard',         corps: 'Crossmen', section: 'Color Guard',        score: 0 },
        { id: 'cross-ge1',                 corps: 'Crossmen', section: 'General Effect 1',   score: 0 },
        { id: 'cross-ge2',                 corps: 'Crossmen', section: 'General Effect 2',   score: 0 },
        { id: 'cross-visual-proficiency',  corps: 'Crossmen', section: 'Visual Proficiency', score: 0 },
        { id: 'cross-visual-analysis',     corps: 'Crossmen', section: 'Visual Analysis',    score: 0 },
        // Spirit of Atlanta
        { id: 'soa-brass',               corps: 'Spirit of Atlanta', section: 'Brass',              score: 0 },
        { id: 'soa-music-analysis',      corps: 'Spirit of Atlanta', section: 'Music Analysis',     score: 0 },
        { id: 'soa-percussion',          corps: 'Spirit of Atlanta', section: 'Percussion',         score: 0 },
        { id: 'soa-color-guard',         corps: 'Spirit of Atlanta', section: 'Color Guard',        score: 0 },
        { id: 'soa-ge1',                 corps: 'Spirit of Atlanta', section: 'General Effect 1',   score: 0 },
        { id: 'soa-ge2',                 corps: 'Spirit of Atlanta', section: 'General Effect 2',   score: 0 },
        { id: 'soa-visual-proficiency',  corps: 'Spirit of Atlanta', section: 'Visual Proficiency', score: 0 },
        { id: 'soa-visual-analysis',     corps: 'Spirit of Atlanta', section: 'Visual Analysis',    score: 0 },
        // Pacific Crest
        { id: 'pc-brass',               corps: 'Pacific Crest', section: 'Brass',              score: 0 },
        { id: 'pc-music-analysis',      corps: 'Pacific Crest', section: 'Music Analysis',     score: 0 },
        { id: 'pc-percussion',          corps: 'Pacific Crest', section: 'Percussion',         score: 0 },
        { id: 'pc-color-guard',         corps: 'Pacific Crest', section: 'Color Guard',        score: 0 },
        { id: 'pc-ge1',                 corps: 'Pacific Crest', section: 'General Effect 1',   score: 0 },
        { id: 'pc-ge2',                 corps: 'Pacific Crest', section: 'General Effect 2',   score: 0 },
        { id: 'pc-visual-proficiency',  corps: 'Pacific Crest', section: 'Visual Proficiency', score: 0 },
        { id: 'pc-visual-analysis',     corps: 'Pacific Crest', section: 'Visual Analysis',    score: 0 },
        // Music City
        { id: 'mc-brass',               corps: 'Music City', section: 'Brass',              score: 0 },
        { id: 'mc-music-analysis',      corps: 'Music City', section: 'Music Analysis',     score: 0 },
        { id: 'mc-percussion',          corps: 'Music City', section: 'Percussion',         score: 0 },
        { id: 'mc-color-guard',         corps: 'Music City', section: 'Color Guard',        score: 0 },
        { id: 'mc-ge1',                 corps: 'Music City', section: 'General Effect 1',   score: 0 },
        { id: 'mc-ge2',                 corps: 'Music City', section: 'General Effect 2',   score: 0 },
        { id: 'mc-visual-proficiency',  corps: 'Music City', section: 'Visual Proficiency', score: 0 },
        { id: 'mc-visual-analysis',     corps: 'Music City', section: 'Visual Analysis',    score: 0 },
        // The Academy
        { id: 'acad-brass',               corps: 'The Academy', section: 'Brass',              score: 0 },
        { id: 'acad-music-analysis',      corps: 'The Academy', section: 'Music Analysis',     score: 0 },
        { id: 'acad-percussion',          corps: 'The Academy', section: 'Percussion',         score: 0 },
        { id: 'acad-color-guard',         corps: 'The Academy', section: 'Color Guard',        score: 0 },
        { id: 'acad-ge1',                 corps: 'The Academy', section: 'General Effect 1',   score: 0 },
        { id: 'acad-ge2',                 corps: 'The Academy', section: 'General Effect 2',   score: 0 },
        { id: 'acad-visual-proficiency',  corps: 'The Academy', section: 'Visual Proficiency', score: 0 },
        { id: 'acad-visual-analysis',     corps: 'The Academy', section: 'Visual Analysis',    score: 0 },
        // Troopers
        { id: 'troop-brass',               corps: 'Troopers', section: 'Brass',              score: 0 },
        { id: 'troop-music-analysis',      corps: 'Troopers', section: 'Music Analysis',     score: 0 },
        { id: 'troop-percussion',          corps: 'Troopers', section: 'Percussion',         score: 0 },
        { id: 'troop-color-guard',         corps: 'Troopers', section: 'Color Guard',        score: 0 },
        { id: 'troop-ge1',                 corps: 'Troopers', section: 'General Effect 1',   score: 0 },
        { id: 'troop-ge2',                 corps: 'Troopers', section: 'General Effect 2',   score: 0 },
        { id: 'troop-visual-proficiency',  corps: 'Troopers', section: 'Visual Proficiency', score: 0 },
        { id: 'troop-visual-analysis',     corps: 'Troopers', section: 'Visual Analysis',    score: 0 },
        // Colts
        { id: 'colts-brass',               corps: 'Colts', section: 'Brass',              score: 0 },
        { id: 'colts-music-analysis',      corps: 'Colts', section: 'Music Analysis',     score: 0 },
        { id: 'colts-percussion',          corps: 'Colts', section: 'Percussion',         score: 0 },
        { id: 'colts-color-guard',         corps: 'Colts', section: 'Color Guard',        score: 0 },
        { id: 'colts-ge1',                 corps: 'Colts', section: 'General Effect 1',   score: 0 },
        { id: 'colts-ge2',                 corps: 'Colts', section: 'General Effect 2',   score: 0 },
        { id: 'colts-visual-proficiency',  corps: 'Colts', section: 'Visual Proficiency', score: 0 },
        { id: 'colts-visual-analysis',     corps: 'Colts', section: 'Visual Analysis',    score: 0 },
        // Spartans
        { id: 'sparts-brass',               corps: 'Spartans', section: 'Brass',              score: 0 },
        { id: 'sparts-music-analysis',      corps: 'Spartans', section: 'Music Analysis',     score: 0 },
        { id: 'sparts-percussion',          corps: 'Spartans', section: 'Percussion',         score: 0 },
        { id: 'sparts-color-guard',         corps: 'Spartans', section: 'Color Guard',        score: 0 },
        { id: 'sparts-ge1',                 corps: 'Spartans', section: 'General Effect 1',   score: 0 },
        { id: 'sparts-ge2',                 corps: 'Spartans', section: 'General Effect 2',   score: 0 },
        { id: 'sparts-visual-proficiency',  corps: 'Spartans', section: 'Visual Proficiency', score: 0 },
        { id: 'sparts-visual-analysis',     corps: 'Spartans', section: 'Visual Analysis',    score: 0 },
        // Genesis
        { id: 'gen-brass',               corps: 'Genesis', section: 'Brass',              score: 0 },
        { id: 'gen-music-analysis',      corps: 'Genesis', section: 'Music Analysis',     score: 0 },
        { id: 'gen-percussion',          corps: 'Genesis', section: 'Percussion',         score: 0 },
        { id: 'gen-color-guard',         corps: 'Genesis', section: 'Color Guard',        score: 0 },
        { id: 'gen-ge1',                 corps: 'Genesis', section: 'General Effect 1',   score: 0 },
        { id: 'gen-ge2',                 corps: 'Genesis', section: 'General Effect 2',   score: 0 },
        { id: 'gen-visual-proficiency',  corps: 'Genesis', section: 'Visual Proficiency', score: 0 },
        { id: 'gen-visual-analysis',     corps: 'Genesis', section: 'Visual Analysis',    score: 0 },
        // Seattle Cascades
        { id: 'cas-brass',               corps: 'Seattle Cascades', section: 'Brass',              score: 0 },
        { id: 'cas-music-analysis',      corps: 'Seattle Cascades', section: 'Music Analysis',     score: 0 },
        { id: 'cas-percussion',          corps: 'Seattle Cascades', section: 'Percussion',         score: 0 },
        { id: 'cas-color-guard',         corps: 'Seattle Cascades', section: 'Color Guard',        score: 0 },
        { id: 'cas-ge1',                 corps: 'Seattle Cascades', section: 'General Effect 1',   score: 0 },
        { id: 'cas-ge2',                 corps: 'Seattle Cascades', section: 'General Effect 2',   score: 0 },
        { id: 'cas-visual-proficiency',  corps: 'Seattle Cascades', section: 'Visual Proficiency', score: 0 },
        { id: 'cas-visual-analysis',     corps: 'Seattle Cascades', section: 'Visual Analysis',    score: 0 },
    ];

    // Get already-drafted captions
    const drafted = await db.query(
        'SELECT caption_id FROM draft_picks WHERE league_id = $1',
        [leagueId]
    );
    const draftedIds = new Set(drafted.rows.map(r => r.caption_id));

    // Get sections this player already has
    const myPicks = await db.query(
        'SELECT section_type FROM draft_picks WHERE league_id = $1 AND user_id = $2',
        [leagueId, userId]
    );
    const myDraftedSections = new Set(myPicks.rows.map(r => r.section_type));

    // Find best available caption the player still needs
    const available = ALL_CAPTIONS
        .filter(c => !draftedIds.has(c.id) && !myDraftedSections.has(c.section))
        .sort((a, b) => b.score - a.score);

    if (available.length === 0) {
        console.log(`[Socket] Auto-pick: no available captions for user ${userId}`);
        return;
    }

    const pick = available[0];

    await db.query(`
        INSERT INTO draft_picks (league_id, user_id, caption_id, section_type, pick_number)
        VALUES ($1, $2, $3, $4, $5)
    `, [leagueId, userId, pick.id, pick.section, turnIndex]);

    io.to(`league-${leagueId}`).emit('pick-made', {
        userId,
        username: '[Auto-pick]',
        captionId: pick.id,
        section: pick.section,
        pickNumber: turnIndex,
        autoPickd: true
    });

    const totalPicks = draftOrder.length * 8;
    const newTurn = turnIndex + 1;

    if (newTurn < totalPicks) {
        await db.query('UPDATE leagues SET current_draft_turn = $2 WHERE id = $1', [leagueId, newTurn]);
        await startTurn(io, db, draftTimers, leagueId, newTurn, playerCount || draftOrder.length);
    } else {
        await db.query('UPDATE leagues SET draft_completed = true WHERE id = $1', [leagueId]);
        io.to(`league-${leagueId}`).emit('draft-completed');
    }
}

function deriveSectionFromCaptionId(captionId) {
    if (captionId.includes('music-analysis'))     return 'Music Analysis';
    if (captionId.includes('color-guard'))        return 'Color Guard';
    if (captionId.includes('ge1'))                return 'General Effect 1';
    if (captionId.includes('ge2'))                return 'General Effect 2';
    if (captionId.includes('visual-proficiency')) return 'Visual Proficiency';
    if (captionId.includes('visual-analysis'))    return 'Visual Analysis';
    if (captionId.includes('brass'))              return 'Brass';
    if (captionId.includes('percussion'))         return 'Percussion';
    return 'Unknown';
}

module.exports = { setupDraftSocket };
