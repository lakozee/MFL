const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const db = require('../../database/db');

const SALT_ROUNDS = 10;

// Password validation regex
const PASSWORD_REGEX = /^(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;

        // Validate email
        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        // Validate username
        if (!username || username.length < 3 || username.length > 50) {
            return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
        }

        // Validate password requirements
        if (!password || password.length < 12) {
            return res.status(400).json({
                error: 'Password must be at least 12 characters long'
            });
        }

        if (!PASSWORD_REGEX.test(password)) {
            return res.status(400).json({
                error: 'Password must contain at least one number and one special character'
            });
        }

        // Check if user already exists
        const existingUser = await db.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email.toLowerCase(), username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email or username already registered' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert new user
        const result = await db.query(
            'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, profile_picture_url, created_at',
            [email.toLowerCase(), username, passwordHash]
        );

        const user = result.rows[0];

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.status(201).json({
            message: 'Account created successfully',
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                profile_picture_url: user.profile_picture_url,
                createdAt: user.created_at
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate inputs
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const result = await db.query(
            'SELECT id, email, username, password_hash, profile_picture_url FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            console.warn('[auth-debug] login fail: no account for', email.toLowerCase());
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            console.warn('[auth-debug] login fail: wrong password for user', user.id);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        console.log('[auth-debug] login ok: user', user.id, '- setting cookie (secure:', process.env.NODE_ENV === 'production', ')');

        // Update last login
        await db.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                profile_picture_url: user.profile_picture_url
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
});

// Verify session
router.get('/verify', async (req, res) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ authenticated: false });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch user data including profile picture
        const result = await db.query(
            'SELECT id, email, username, profile_picture_url, is_admin FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ authenticated: false });
        }

        const user = result.rows[0];

        res.json({
            authenticated: true,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                profile_picture_url: user.profile_picture_url,
                is_admin: user.is_admin
            }
        });
    } catch (error) {
        res.status(401).json({ authenticated: false });
    }
});

module.exports = router;
