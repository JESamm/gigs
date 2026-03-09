const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Start or get existing conversation (employer initiates)
router.post('/conversations', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { student_id, gig_id, initial_message } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'Student ID is required.' });
    }

    // Verify student exists and is a student
    const student = db.prepare('SELECT id, role, full_name FROM users WHERE id = ? AND role = ?').get(student_id, 'student');
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    // Determine employer_id and student_id based on who's initiating
    let employerId, studentId;
    if (req.user.role === 'employer') {
      employerId = req.user.id;
      studentId = student_id;
    } else {
      // Students can also open existing conversations
      const employer = db.prepare('SELECT id, role FROM users WHERE id = ? AND role = ?').get(student_id, 'employer');
      if (employer) {
        employerId = student_id;
        studentId = req.user.id;
      } else {
        return res.status(400).json({ error: 'Can only chat with employers.' });
      }
    }

    // Check if conversation already exists
    let conversation = db.prepare('SELECT * FROM conversations WHERE employer_id = ? AND student_id = ?')
      .get(employerId, studentId);

    if (!conversation) {
      // Create new conversation
      const result = db.prepare('INSERT INTO conversations (employer_id, student_id, gig_id) VALUES (?, ?, ?)')
        .run(employerId, studentId, gig_id || null);

      conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);

      // Send notification to the student about new conversation
      const employer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(employerId);
      const gigInfo = gig_id ? db.prepare('SELECT title FROM gigs WHERE id = ?').get(gig_id) : null;

      db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
        .run(
          studentId,
          'New Message from Employer 💬',
          `${employer.full_name} wants to chat with you${gigInfo ? ` about "${gigInfo.title}"` : ''}. Keep all conversations on GigConnect for your safety!`,
          'info',
          '#/messages'
        );
    }

    // Send initial message if provided
    if (initial_message && initial_message.trim()) {
      db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)')
        .run(conversation.id, req.user.id, initial_message.trim());

      db.prepare('UPDATE conversations SET last_message = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(initial_message.trim().substring(0, 100), conversation.id);
    }

    res.json({ conversation_id: conversation.id });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: 'Failed to start conversation.' });
  }
});

// Get all conversations for the current user
router.get('/conversations', authenticate, (req, res) => {
  try {
    const db = getDb();

    const conversations = db.prepare(`
      SELECT c.*,
        CASE WHEN ? = c.employer_id THEN su.full_name ELSE eu.full_name END as other_name,
        CASE WHEN ? = c.employer_id THEN su.avatar_url ELSE eu.avatar_url END as other_avatar,
        CASE WHEN ? = c.employer_id THEN su.id ELSE eu.id END as other_id,
        CASE WHEN ? = c.employer_id THEN 'student' ELSE 'employer' END as other_role,
        eu.full_name as employer_name,
        su.full_name as student_name,
        g.title as gig_title,
        ep.company_name,
        sp.school_name,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read = 0 AND m.sender_id != ?) as unread_count
      FROM conversations c
      JOIN users eu ON c.employer_id = eu.id
      JOIN users su ON c.student_id = su.id
      LEFT JOIN gigs g ON c.gig_id = g.id
      LEFT JOIN employer_profiles ep ON eu.id = ep.user_id
      LEFT JOIN student_profiles sp ON su.id = sp.user_id
      WHERE c.employer_id = ? OR c.student_id = ?
      ORDER BY c.last_message_at DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

    // Get total unread count
    const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);

    res.json({ conversations, unreadTotal });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

// Get messages for a conversation
router.get('/conversations/:id/messages', authenticate, (req, res) => {
  try {
    const db = getDb();
    const convId = req.params.id;

    // Verify user is part of this conversation
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND (employer_id = ? OR student_id = ?)')
      .get(convId, req.user.id, req.user.id);

    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const messages = db.prepare(`
      SELECT m.*, u.full_name as sender_name, u.avatar_url as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
    `).all(convId);

    // Mark messages as read for the current user (messages sent by other person)
    db.prepare('UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0')
      .run(convId, req.user.id);

    // Get conversation details
    const otherUserId = conv.employer_id === req.user.id ? conv.student_id : conv.employer_id;
    const otherUser = db.prepare('SELECT id, full_name, avatar_url, role FROM users WHERE id = ?').get(otherUserId);

    let otherProfile;
    if (otherUser.role === 'student') {
      otherProfile = db.prepare('SELECT school_name, major FROM student_profiles WHERE user_id = ?').get(otherUserId);
    } else {
      otherProfile = db.prepare('SELECT company_name, industry FROM employer_profiles WHERE user_id = ?').get(otherUserId);
    }

    const gig = conv.gig_id ? db.prepare('SELECT id, title FROM gigs WHERE id = ?').get(conv.gig_id) : null;

    res.json({
      messages,
      conversation: conv,
      otherUser: { ...otherUser, profile: otherProfile },
      gig
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// Send a message
router.post('/conversations/:id/messages', authenticate, (req, res) => {
  try {
    const db = getDb();
    const convId = req.params.id;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    // Verify user is part of this conversation
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND (employer_id = ? OR student_id = ?)')
      .get(convId, req.user.id, req.user.id);

    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    // Detect if message contains external contact info (warn student safety)
    const suspiciousPatterns = /(\b\d{10,}\b|whatsapp|telegram|signal|@gmail|@yahoo|@hotmail|meet me outside|pay.*cash|off.*platform)/i;
    let warning = null;
    if (suspiciousPatterns.test(content)) {
      warning = 'safety_warning';
    }

    const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)')
      .run(convId, req.user.id, content.trim());

    // Update conversation's last message
    db.prepare('UPDATE conversations SET last_message = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content.trim().substring(0, 100), convId);

    // Send notification to the other person
    const otherUserId = conv.employer_id === req.user.id ? conv.student_id : conv.employer_id;
    const senderName = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id).full_name;

    db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
      .run(
        otherUserId,
        `New message from ${senderName} 💬`,
        content.trim().substring(0, 80) + (content.length > 80 ? '...' : ''),
        'info',
        `#/messages/${convId}`
      );

    const message = db.prepare(`
      SELECT m.*, u.full_name as sender_name, u.avatar_url as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(result.lastInsertRowid);

    res.json({ message, warning });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// Get unread message count
router.get('/unread-count', authenticate, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.read = 0 AND m.sender_id != ? AND (c.employer_id = ? OR c.student_id = ?)
    `).get(req.user.id, req.user.id, req.user.id);

    res.json({ count: result.count });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count.' });
  }
});

module.exports = router;
