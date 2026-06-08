const http = require('http');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const leaguesRoutes = require('./routes/leagues');
const teamsRoutes = require('./routes/teams');
const draftRoutes = require('./routes/draft');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const { optionalAuth } = require('./middleware/auth');
const { setupDraftSocket } = require('./socket/draftSocket');
const { pool } = require('../database/db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust Railway's proxy so rate limiting and IP detection work correctly
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for development
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many login attempts, please try again later.' });
    }
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', limiter);

// CORS — in production the frontend is served by this same Express process,
// so cross-origin requests only come from explicit integrations.
// Set ALLOWED_ORIGIN on Railway if you have a separate frontend domain.
const allowedOrigin = isProduction
    ? (process.env.ALLOWED_ORIGIN || false)
    : 'http://localhost:3000';

if (allowedOrigin) {
    app.use(cors({
        origin: allowedOrigin,
        credentials: true
    }));
}

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check (for Railway and uptime monitors)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/leagues', leaguesRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/draft', draftRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Page routes
app.get('/', optionalAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/app', optionalAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/app.html'));
});

app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/auth.html'));
});

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/settings.html'));
});

app.get('/invite/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/league-invite.html'));
});

app.get('/league/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/draft.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/stats.html'));
});

app.get('/league-stats/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/league-stats.html'));
});

app.get('/scores', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/scores.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/how-to-play', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/how-to-play.html'));
});

app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/contact.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/terms.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler — catches all unhandled errors from route/middleware
app.use((err, req, res, next) => {
    console.error('[server] Unhandled error:', err.stack || err.message || err);
    res.status(500).json({
        error: isProduction ? 'Internal server error' : err.message
    });
});

// Start server — bind to 0.0.0.0 so Railway can route external traffic
const server = http.createServer(app);
setupDraftSocket(server, pool);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Fantasy DCI running on port ${PORT}`);
    console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('[server] Socket.io draft system active');

    pool.query('SELECT COUNT(*) FROM competitions WHERE season = 2026')
        .then(r => console.log(`[server] competitions(2026) count: ${r.rows[0].count}`))
        .catch(err => console.error('[server] competitions check failed:', err.message));
});

module.exports = app;
