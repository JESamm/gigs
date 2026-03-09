require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./database');
const { initMailer } = require('./utils/mailer');
const { configurePassport } = require('./config/passport');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Ensure JWT_SECRET is set (generate a fallback for convenience, warn in logs)
if (!process.env.JWT_SECRET) {
  const crypto = require('crypto');
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('  ⚠️  JWT_SECRET not set — using auto-generated secret (tokens will reset on restart)');
}

async function startServer() {
  // Initialize database before anything else
  await initDatabase();
  console.log('  ✅ Database initialized');

  // Initialize email transporter
  await initMailer();
  console.log('  ✅ Mailer initialized');

  const authRoutes = require('./routes/auth');
  const gigRoutes = require('./routes/gigs');
  const applicationRoutes = require('./routes/applications');
  const paymentRoutes = require('./routes/payments');
  const userRoutes = require('./routes/users');
  const notificationRoutes = require('./routes/notifications');
  const dashboardRoutes = require('./routes/dashboard');
  const chatRoutes = require('./routes/chat');

  const app = express();
  const PORT = process.env.PORT || 3000;

  // Trust proxy (needed for rate limiting behind reverse proxies like Render, Railway, Heroku)
  app.set('trust proxy', 1);

  // Security headers (relaxed for CDN/proxy compatibility)
  app.use(helmet({
    contentSecurityPolicy: false,           // allow inline scripts in SPA
    crossOriginEmbedderPolicy: false,       // allow loading external resources (OAuth, fonts, etc.)
    crossOriginResourcePolicy: false        // allow CDN/proxy to cache & serve resources
  }));

  // Note: compression handled by Render's Cloudflare CDN — no need for server-side compression

  // Access logging
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // Global rate limiter — 100 requests per minute per IP
  const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use('/api/', globalLimiter);

  // Strict auth rate limiter — 10 attempts per 15 minutes per IP
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // CORS
  const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };
  app.use(cors(corsOptions));

  // Body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static file serving with cache headers
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: isProduction ? '1d' : 0,
    etag: true,
    lastModified: true
  }));

  // Configure Passport (social OAuth)
  configurePassport(app);

  // Health check endpoint (for deployment platforms)
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: NODE_ENV
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/gigs', gigRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/chat', chatRoutes);

  // Serve frontend for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] ERROR:`, err.stack);
    res.status(err.status || 500).json({
      error: isProduction ? 'Something went wrong!' : err.message
    });
  });

  // Start listening
  const server = app.listen(PORT, () => {
    console.log(`\n  ✨ GigConnect server running at http://localhost:${PORT}`);
    console.log(`  📦 Environment: ${NODE_ENV}\n`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n  ⏳ ${signal} received. Shutting down gracefully...`);
    server.close(() => {
      const { getDb } = require('./database');
      const db = getDb();
      if (db && db._save) db._save();
      console.log('  ✅ Database saved. Server closed.');
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
