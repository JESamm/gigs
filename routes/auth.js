const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const { sendWelcomeEmail, sendLoginAlertEmail } = require('../utils/mailer');
const { handleOAuthCallback } = require('../config/passport');
const router = express.Router();

// Register
router.post('/register', (req, res) => {
  try {
    const db = getDb();
    const { email, password, role, full_name, phone, school_name, major, graduation_year, company_name, industry, location } = req.body;

    if (!email || !password || !role || !full_name) {
      return res.status(400).json({ error: 'Email, password, role, and full name are required.' });
    }

    if (!['employer', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either employer or student.' });
    }

    if (role === 'student' && !school_name) {
      return res.status(400).json({ error: 'School name is required for students.' });
    }

    // Check existing user
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 12);

    const insertUser = db.prepare('INSERT INTO users (email, password, role, full_name, phone) VALUES (?, ?, ?, ?, ?)');
    const result = insertUser.run(email, hashedPassword, role, full_name, phone || null);
    const userId = result.lastInsertRowid;

    if (role === 'student') {
      db.prepare('INSERT INTO student_profiles (user_id, school_name, major, graduation_year) VALUES (?, ?, ?, ?)')
        .run(userId, school_name, major || null, graduation_year || null);
    } else {
      db.prepare('INSERT INTO employer_profiles (user_id, company_name, industry, location) VALUES (?, ?, ?, ?)')
        .run(userId, company_name || full_name, industry || null, location || null);
    }

    // Create welcome notification
    db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)')
      .run(userId, 'Welcome to GigConnect! 🎉', `Welcome ${full_name}! Your account has been created successfully. ${role === 'student' ? 'Start browsing gigs now!' : 'Post your first gig to find talented students!'}`, 'success');

    const token = jwt.sign({ id: userId, email, role, full_name }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Send welcome email (async, don't block response)
    sendWelcomeEmail({ email, full_name, role }).catch(() => {});

    res.status(201).json({
      message: 'Registration successful!',
      token,
      user: { id: userId, email, role, full_name, avatar_url: null }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Login
router.post('/login', (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.password && user.oauth_provider) {
      return res.status(401).json({ error: `This account uses ${user.oauth_provider} sign-in. Please log in with ${user.oauth_provider}.` });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 2FA check — if enabled, require verification code
    if (user.two_factor_enabled) {
      const { totp_code } = req.body;
      if (!totp_code) {
        return res.status(200).json({
          requires_2fa: true,
          message: 'Two-factor authentication code required.',
          email: user.email
        });
      }
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: totp_code,
        window: 1
      });
      if (!verified) {
        return res.status(401).json({ error: 'Invalid two-factor authentication code.' });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send login security alert (async, don't block response)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    sendLoginAlertEmail({ email: user.email, full_name: user.full_name }, ip).catch(() => {});

    res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name, avatar_url: user.avatar_url }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Get current user profile
router.get('/me', authenticate, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, email, role, full_name, phone, avatar_url, two_factor_enabled, oauth_provider, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let profile;
    if (user.role === 'student') {
      profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
    } else {
      profile = db.prepare('SELECT * FROM employer_profiles WHERE user_id = ?').get(user.id);
    }

    res.json({ ...user, profile });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ==========================================
//  Social OAuth Routes
// ==========================================

// Google
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google sign-in is not configured. Contact admin.' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback',
  (req, res, next) => passport.authenticate('google', { session: false, failureRedirect: '/#/home?error=google_failed' })(req, res, next),
  handleOAuthCallback
);

// GitHub
router.get('/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(501).json({ error: 'GitHub sign-in is not configured. Contact admin.' });
  }
  passport.authenticate('github', { scope: ['user:email'], session: false })(req, res, next);
});

router.get('/github/callback',
  (req, res, next) => passport.authenticate('github', { session: false, failureRedirect: '/#/home?error=github_failed' })(req, res, next),
  handleOAuthCallback
);

// Check which providers are enabled
router.get('/providers', (req, res) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID,
    github: !!process.env.GITHUB_CLIENT_ID,
    twitter: false, // Can be enabled later
    linkedin: false  // Can be enabled later
  });
});

// ==========================================
//  Two-Factor Authentication (2FA)
// ==========================================

// Generate 2FA secret & QR code
router.post('/2fa/setup', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(req.user.id);

    if (user.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }

    const secret = speakeasy.generateSecret({
      name: `GigConnect (${req.user.email})`,
      issuer: 'GigConnect'
    });

    // Store secret temporarily (not enabled until verified)
    db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?')
      .run(secret.base32, req.user.id);

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qr_code: qrDataUrl,
      message: 'Scan this QR code with your authenticator app, then verify with a code.'
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    res.status(500).json({ error: 'Failed to set up 2FA.' });
  }
});

// Verify & enable 2FA
router.post('/2fa/verify', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: 'Verification code is required.' });

    const user = db.prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?').get(req.user.id);

    if (user.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }

    if (!user.two_factor_secret) {
      return res.status(400).json({ error: 'Please set up 2FA first.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?').run(req.user.id);

    res.json({ message: '2FA has been enabled successfully! 🔒' });
  } catch (err) {
    console.error('2FA verify error:', err);
    res.status(500).json({ error: 'Failed to verify 2FA.' });
  }
});

// Disable 2FA
router.post('/2fa/disable', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: 'Current 2FA code is required to disable.' });

    const user = db.prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?').get(req.user.id);

    if (!user.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is not enabled.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid code. 2FA was not disabled.' });
    }

    db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(req.user.id);

    res.json({ message: '2FA has been disabled.' });
  } catch (err) {
    console.error('2FA disable error:', err);
    res.status(500).json({ error: 'Failed to disable 2FA.' });
  }
});

// Get 2FA status
router.get('/2fa/status', authenticate, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT two_factor_enabled FROM users WHERE id = ?').get(req.user.id);
    res.json({ enabled: !!user.two_factor_enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check 2FA status.' });
  }
});

module.exports = router;
