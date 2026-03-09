const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Get notifications
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
      .get(req.user.id);

    res.json({ notifications, unreadCount: unread.count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// Mark as read
router.put('/read/:id', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification.' });
  }
});

// Mark all as read
router.put('/read-all', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications.' });
  }
});

module.exports = router;
