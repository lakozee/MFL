const http = require('http');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
require('dotenv').config();

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

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for development
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5 // 5 login attempts per 15 minutes
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? 'https://yourdomain.com'
        : 'http://localhost:3000',
    credentials: true
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// Optional auth for static pages (to customize based on login state)
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

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/app.html'));
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

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
});

// Start server with socket.io
const server = http.createServer(app);
setupDraftSocket(server, pool);

server.listen(PORT, () => {
    console.log(`\n✓ Fantasy DCI server running on http://localhost:${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('✓ Socket.io draft system active');
    console.log('\nAPI Endpoints:');
    console.log('  POST /api/auth/register - Create account');
    console.log('  POST /api/auth/login - Login');
    console.log('  POST /api/auth/logout - Logout');
    console.log('  GET  /api/auth/verify - Verify session\n');
});

module.exports = app;
