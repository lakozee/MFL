const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware to verify JWT token from cookies
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        console.warn('[auth-debug] 401 no cookie on', req.method, req.originalUrl);
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.warn('[auth-debug] 403 bad token on', req.method, req.originalUrl, '-', error.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
    const token = req.cookies.token;

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
        } catch (error) {
            // Invalid token, but continue anyway
            req.user = null;
        }
    }

    next();
};

module.exports = {
    authenticateToken,
    optionalAuth
};
