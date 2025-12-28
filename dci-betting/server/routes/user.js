const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../../database/db');

// Update profile picture
router.put('/profile-picture', authenticateToken, async (req, res) => {
    try {
        const { profile_picture_url } = req.body;
        const userId = req.user.userId;

        if (!profile_picture_url) {
            return res.status(400).json({ error: 'Profile picture URL required' });
        }

        // Update user profile picture
        await db.query(
            'UPDATE users SET profile_picture_url = $1 WHERE id = $2',
            [profile_picture_url, userId]
        );

        res.json({
            message: 'Profile picture updated successfully',
            profile_picture_url
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile picture' });
    }
});

module.exports = router;
