const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Configure multer for profile photo uploads
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `user-${req.user.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed.'));
    }
  }
});

// Upload profile photo
router.post('/photo', authenticate, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded.' });
    }

    try {
      const db = getDb();
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;

      // Delete old avatar file if exists
      const oldUser = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
      if (oldUser && oldUser.avatar_url) {
        const oldPath = path.join(__dirname, '..', 'public', oldUser.avatar_url);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      db.prepare('UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(avatarUrl, req.user.id);

      res.json({ message: 'Profile photo updated!', avatar_url: avatarUrl });
    } catch (err) {
      console.error('Photo upload error:', err);
      res.status(500).json({ error: 'Failed to update profile photo.' });
    }
  });
});

// Delete profile photo
router.delete('/photo', authenticate, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);

    if (user && user.avatar_url) {
      const filePath = path.join(__dirname, '..', 'public', user.avatar_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    db.prepare('UPDATE users SET avatar_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.user.id);

    res.json({ message: 'Profile photo removed.' });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to remove photo.' });
  }
});

// Update profile
router.put('/profile', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { full_name, phone } = req.body;

    if (full_name) {
      db.prepare('UPDATE users SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(full_name, phone || null, req.user.id);
    }

    if (req.user.role === 'student') {
      const { school_name, major, graduation_year, gpa, bio, skills, portfolio_url } = req.body;
      db.prepare(`UPDATE student_profiles SET school_name = COALESCE(?, school_name), major = COALESCE(?, major),
        graduation_year = COALESCE(?, graduation_year), gpa = COALESCE(?, gpa), bio = COALESCE(?, bio),
        skills = COALESCE(?, skills), portfolio_url = COALESCE(?, portfolio_url)
        WHERE user_id = ?`)
        .run(school_name, major, graduation_year, gpa, bio, skills, portfolio_url, req.user.id);
    } else {
      const { company_name, company_description, industry, website, location } = req.body;
      db.prepare(`UPDATE employer_profiles SET company_name = COALESCE(?, company_name), company_description = COALESCE(?, company_description),
        industry = COALESCE(?, industry), website = COALESCE(?, website), location = COALESCE(?, location)
        WHERE user_id = ?`)
        .run(company_name, company_description, industry, website, location, req.user.id);
    }

    res.json({ message: 'Profile updated successfully!' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Get public user profile
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, role, full_name, avatar_url, created_at FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let profile;
    if (user.role === 'student') {
      profile = db.prepare('SELECT school_name, major, graduation_year, bio, skills, portfolio_url, total_earned FROM student_profiles WHERE user_id = ?').get(user.id);
    } else {
      profile = db.prepare('SELECT company_name, company_description, industry, website, location, verified FROM employer_profiles WHERE user_id = ?').get(user.id);
    }

    const reviews = db.prepare(`
      SELECT r.*, u.full_name as reviewer_name FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.reviewee_id = ? ORDER BY r.created_at DESC LIMIT 10
    `).all(req.params.id);

    const avgRating = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE reviewee_id = ?').get(req.params.id);

    res.json({ ...user, profile, reviews, rating: avgRating });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

module.exports = router;
