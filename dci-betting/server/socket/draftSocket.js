const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

function setupDraftSocket(server, db) {
    const io = socketIo(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            credentials: true
        }
    });

    // Track active draft timers
    const draftTimers = new Map();

    // Middleware: Authenticate socket connections
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('No token provided'));
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            next();
        } catch (error) {
            next(new Error('Authentication failed'));
        }
    });

    // Main connection handler
    io.on('connection', (socket) => {
        console.log(`User ${socket.username} (${socket.userId}) connected`);

        // Join draft lobby
        socket.on('join-lobby', async (leagueId) => {
            try {
                // Verify user is member of league
                const memberCheck = await db.query(
                    'SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2',
                    [leagueId, socket.userId]
                );

                if (memberCheck.rows.length === 0) {
                    socket.emit('error', { message: 'Not a member of this league' });
                    return;
                }

                // Join socket room for this league
                socket.join(`league-${leagueId}`);
                socket.currentLeagueId = leagueId;

                // Update or create draft session
                await db.query(`
                    INSERT INTO draft_sessions (league_id, user_id, is_connected, is_ready, last_heartbeat)
                    VALUES ($1, $2, true, false, NOW())
                    ON CONFLICT (league_id, user_id)
                    DO UPDATE SET is_connected = true, last_heartbeat = NOW()
                `, [leagueId, socket.userId]);

                // Get current lobby state
                const lobbyState = await getLobbyState(db, leagueId);

                // Send current state to joining player
                socket.emit('lobby-state', lobbyState);

                // Notify everyone about new player
                io.to(`league-${leagueId}`).emit('player-joined', {
                    userId: socket.userId,
                    username: socket.username
                });

                console.log(`${socket.username} joined lobby for league ${leagueId}`);
            } catch (error) {
                console.error('join-lobby error:', error);
                socket.emit('error', { message: 'Failed to join lobby' });
            }
        });

        // Ready up
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

                // Notify everyone about ready status change
                io.to(`league-${leagueId}`).emit('player-ready-changed', {
                    userId: socket.userId,
                    username: socket.username,
                    isReady
                });

                // Check if all players are ready
                const lobbyState = await getLobbyState(db, leagueId);
                io.to(`league-${leagueId}`).emit('lobby-state', lobbyState);

                console.log(`${socket.username} ${isReady ? 'ready' : 'not ready'} in league ${leagueId}`);
            } catch (error) {
                console.error('ready-up error:', error);
                socket.emit('error', { message: 'Failed to update ready status' });
            }
        });

        // Start draft (creator only)
        socket.on('start-draft', async (data) => {
            try {
                const { leagueId, turnTimer } = data;

                // Verify user is creator
                const leagueCheck = await db.query(
                    'SELECT creator_id FROM leagues WHERE id = $1',
                    [leagueId]
                );

                if (leagueCheck.rows.length === 0 || leagueCheck.rows[0].creator_id !== socket.userId) {
                    socket.emit('error', { message: 'Only league creator can start draft' });
                    return;
                }

                // Verify all players are ready
                const lobbyState = await getLobbyState(db, leagueId);
                if (!lobbyState.allReady || !lobbyState.allConnected) {
                    socket.emit('error', { message: 'Not all players are ready' });
                    return;
                }

                // Update league
                await db.query(`
                    UPDATE leagues
                    SET draft_started = true, 
                        draft_lobby_open = false,
                        turn_timer_seconds = $2,
                        current_draft_turn = 0
                    WHERE id = $1
                `, [leagueId, turnTimer || null]);

                // Notify all players draft has started
                io.to(`league-${leagueId}`).emit('draft-started', {
                    turnTimer,
                    draftOrder: lobbyState.draftOrder
                });

                // Start first turn (always unlimited)
                startTurn(io, db, leagueId, 0, true);

                console.log(`Draft started for league ${leagueId} with timer: ${turnTimer || 'unlimited'}`);
            } catch (error) {
                console.error('start-draft error:', error);
                socket.emit('error', { message: 'Failed to start draft' });
            }
        });

        // Make draft pick
        socket.on('make-pick', async (data) => {
            try {
                const { leagueId, captionId } = data;

                // Verify it's player's turn
                const league = await db.query(
                    'SELECT current_draft_turn FROM leagues WHERE id = $1',
                    [leagueId]
                );

                const draftOrder = await getDraftOrder(db, leagueId);
                const currentTurnUserId = draftOrder[league.rows[0].current_draft_turn];

                if (currentTurnUserId !== socket.userId) {
                    socket.emit('error', { message: 'Not your turn' });
                    return;
                }

                // Get caption details
                const sectionMap = {
                    'Brass': 'brass',
                    'Percussion': 'percussion',
                    'Color Guard': 'colorGuard',
                    'General Effect': 'generalEffect',
                    'Visual Performance': 'visualPerformance'
                };

                // This would come from frontend state, but for MVP we'll derive it
                // In production, caption metadata should come from a captions table
                const section = deriveSectionFromCaptionId(captionId);

                // Record pick
                const pickNumber = league.rows[0].current_draft_turn;
                await db.query(`
                    INSERT INTO draft_picks (league_id, user_id, caption_id, section_type, pick_number)
                    VALUES ($1, $2, $3, $4, $5)
                `, [leagueId, socket.userId, captionId, section, pickNumber]);

                // Stop current timer
                stopTurnTimer(leagueId, draftTimers);

                // Notify all players about pick
                io.to(`league-${leagueId}`).emit('pick-made', {
                    userId: socket.userId,
                    username: socket.username,
                    captionId,
                    pickNumber
                });

                // Move to next turn
                const newTurn = pickNumber + 1;
                const totalPicks = draftOrder.length * 5; // 5 rounds

                if (newTurn < totalPicks) {
                    await db.query(
                        'UPDATE leagues SET current_draft_turn = $2 WHERE id = $1',
                        [leagueId, newTurn]
                    );

                    // Check if next player is connected
                    const nextUserId = draftOrder[newTurn % draftOrder.length];
                    const isFirstTurn = Math.floor(newTurn / draftOrder.length) === 0;

                    await startTurn(io, db, leagueId, newTurn, isFirstTurn);
                } else {
                    // Draft complete
                    await db.query(
                        'UPDATE leagues SET draft_completed = true WHERE id = $1',
                        [leagueId]
                    );

                    io.to(`league-${leagueId}`).emit('draft-completed');
                    console.log(`Draft completed for league ${leagueId}`);
                }

                console.log(`${socket.username} picked ${captionId} in league ${leagueId}`);
            } catch (error) {
                console.error('make-pick error:', error);
                socket.emit('error', { message: 'Failed to make pick' });
            }
        });

        // Heartbeat for connection tracking
        socket.on('heartbeat', async (leagueId) => {
            try {
                await db.query(`
                    UPDATE draft_sessions
                    SET last_heartbeat = NOW()
                    WHERE league_id = $1 AND user_id = $2
                `, [leagueId, socket.userId]);
            } catch (error) {
                console.error('heartbeat error:', error);
            }
        });

        // Disconnect
        socket.on('disconnect', async () => {
            try {
                if (socket.currentLeagueId) {
                    await db.query(`
                        UPDATE draft_sessions
                        SET is_connected = false
                        WHERE league_id = $1 AND user_id = $2
                    `, [socket.currentLeagueId, socket.userId]);

                    // Notify everyone
                    io.to(`league-${socket.currentLeagueId}`).emit('player-disconnected', {
                        userId: socket.userId,
                        username: socket.username
                    });

                    console.log(`${socket.username} disconnected from league ${socket.currentLeagueId}`);
                }
            } catch (error) {
                console.error('disconnect error:', error);
            }
        });
    });

    return io;
}

// Helper Functions

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
        'SELECT max_players, creator_id FROM leagues WHERE id = $1',
        [leagueId]
    );

    const players = sessions.rows.map(row => ({
        userId: row.user_id,
        username: row.username,
        teamName: row.team_name,
        isConnected: row.is_connected,
        isReady: row.is_ready
    }));

    const allConnected = players.every(p => p.is_connected);
    const allReady = players.every(p => p.isReady);
    const requiredPlayers = league.rows[0]?.max_players || 0;

    return {
        players,
        allConnected,
        allReady,
        canStart: players.length >= 4 && allConnected && allReady,
        creatorId: league.rows[0]?.creator_id,
        draftOrder: players.map(p => p.userId)
    };
}

async function getDraftOrder(db, leagueId) {
    const members = await db.query(`
        SELECT user_id
        FROM league_members
        WHERE league_id = $1
        ORDER BY draft_position
    `, [leagueId]);

    return members.rows.map(row => row.user_id);
}

async function startTurn(io, db, leagueId, turnIndex, isFirstTurn) {
    const draftOrder = await getDraftOrder(db, leagueId);
    const currentUserId = draftOrder[turnIndex % draftOrder.length];
    const nextUserId = draftOrder[(turnIndex + 1) % draftOrder.length];

    // Check if current player is connected
    const session = await db.query(
        'SELECT is_connected FROM draft_sessions WHERE league_id = $1 AND user_id = $2',
        [leagueId, currentUserId]
    );

    if (session.rows.length > 0 && !session.rows[0].is_connected) {
        // Player disconnected, pause draft
        io.to(`league-${leagueId}`).emit('draft-paused', {
            reason: 'Current player is disconnected',
            userId: currentUserId
        });
        return;
    }

    // Emit turn change
    io.to(`league-${leagueId}`).emit('turn-changed', {
        currentUserId,
        nextUserId,
        turnIndex
    });

    // Start timer if not first turn
    if (!isFirstTurn) {
        const league = await db.query(
            'SELECT turn_timer_seconds FROM leagues WHERE id = $1',
            [leagueId]
        );
        const timerSeconds = league.rows[0]?.turn_timer_seconds;

        if (timerSeconds) {
            startTurnTimer(io, db, leagueId, timerSeconds, turnIndex, draftOrder);
        }
    } else {
        // First turn = unlimited
        io.to(`league-${leagueId}`).emit('timer-tick', 'unlimited');
    }
}

function startTurnTimer(io, db, leagueId, duration, turnIndex, draftOrder) {
    let remainingSeconds = duration;

    const timerId = setInterval(async () => {
        remainingSeconds--;

        io.to(`league-${leagueId}`).emit('timer-tick', remainingSeconds);

        if (remainingSeconds <= 0) {
            clearInterval(timerId);
            draftTimers.delete(`${leagueId}-${turnIndex}`);

            // Auto-pick highest rated available caption
            await autoPickCaption(io, db, leagueId, turnIndex, draftOrder);
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

async function autoPickCaption(io, db, leagueId, turnIndex, draftOrder) {
    // Get highest rated available caption
    // For MVP, we'll need caption data - this is simplified
    const userId = draftOrder[turnIndex % draftOrder.length];

    console.log(`Auto-picking for user ${userId} due to timeout`);

    // This would need actual caption selection logic
    // For now, emit timeout event
    io.to(`league-${leagueId}`).emit('turn-timeout', {
        userId,
        turnIndex
    });
}

function deriveSectionFromCaptionId(captionId) {
    // Simple derivation from caption ID format
    if (captionId.includes('brass')) return 'Brass';
    if (captionId.includes('percussion')) return 'Percussion';
    if (captionId.includes('guard')) return 'Color Guard';
    if (captionId.includes('ge')) return 'General Effect';
    if (captionId.includes('visual')) return 'Visual Performance';
    return 'Unknown';
}

module.exports = { setupDraftSocket };
