const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

/**
 * Configure Passport OAuth strategies.
 * Each provider is only enabled when its env vars are set.
 */
function configurePassport(app) {
  app.use(passport.initialize());

  // ── Google ──────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`
    }, (accessToken, refreshToken, profile, done) => {
      done(null, {
        provider: 'google',
        id: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value
      });
    }));
    console.log('  🔑 Google OAuth enabled');
  }

  // ── GitHub ──────────────────────────────────────
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/github/callback`,
      scope: ['user:email']
    }, (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.find(e => e.primary)?.value || profile.emails?.[0]?.value || `${profile.username}@github.local`;
      done(null, {
        provider: 'github',
        id: String(profile.id),
        email,
        name: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value
      });
    }));
    console.log('  🔑 GitHub OAuth enabled');
  }

  // ── Shared callback handler ────────────────────
  // (used by route callbacks after passport authenticates)
}

/**
 * Find or create a user from an OAuth profile, then issue a JWT
 * and redirect to the frontend with the token.
 */
function handleOAuthCallback(req, res) {
  const profile = req.user;
  if (!profile || !profile.email) {
    return res.redirect('/#/home?error=oauth_no_email');
  }

  const db = getDb();

  // Check if user exists by oauth provider+id first
  let user = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?')
    .get(profile.provider, profile.id);

  if (!user) {
    // Check if email already exists (link account)
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
    if (user) {
      // Link the OAuth to existing account
      db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?')
        .run(profile.provider, profile.id, profile.avatar || null, user.id);
    } else {
      // Create new user — default role is student (they can pick on a role-select page)
      const result = db.prepare(
        'INSERT INTO users (email, role, full_name, avatar_url, oauth_provider, oauth_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(profile.email, 'student', profile.name, profile.avatar || null, profile.provider, profile.id);

      const userId = result.lastInsertRowid;
      db.prepare('INSERT INTO student_profiles (user_id, school_name) VALUES (?, ?)')
        .run(userId, 'Not specified');
      db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)')
        .run(userId, 'Welcome to GigConnect! 🎉', `Welcome ${profile.name}! Your account was created via ${profile.provider}. Update your profile to get started!`, 'success');

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
  }

  // Issue JWT
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const userPayload = encodeURIComponent(JSON.stringify({
    id: user.id, email: user.email, role: user.role,
    full_name: user.full_name, avatar_url: user.avatar_url
  }));

  // Redirect to frontend with token in URL (frontend will extract and store it)
  res.redirect(`/#/oauth-callback?token=${token}&user=${userPayload}`);
}

module.exports = { configurePassport, handleOAuthCallback };
