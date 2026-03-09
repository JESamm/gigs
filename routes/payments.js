const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Release payment (employer marks gig complete)
router.post('/release/:paymentId', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND employer_id = ? AND status = ?')
      .get(req.params.paymentId, req.user.id, 'pending');

    if (!payment) return res.status(404).json({ error: 'Payment not found or already processed.' });

    const txRef = 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    db.prepare("UPDATE payments SET status = 'completed', transaction_ref = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(txRef, payment.id);

    db.prepare("UPDATE gigs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(payment.gig_id);

    // Update student earnings
    db.prepare('UPDATE student_profiles SET total_earned = total_earned + ? WHERE user_id = ?')
      .run(payment.amount, payment.student_id);

    // Notify student
    db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)')
      .run(payment.student_id, 'Payment Received! 💰', `You received KSh ${payment.amount.toLocaleString()} for completing a gig. Transaction: ${txRef}`, 'success');

    res.json({ message: 'Payment released successfully!', transaction_ref: txRef });
  } catch (err) {
    console.error('Release payment error:', err);
    res.status(500).json({ error: 'Failed to release payment.' });
  }
});

// Get employer's payments
router.get('/employer', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const payments = db.prepare(`
      SELECT p.*, g.title as gig_title, u.full_name as student_name
      FROM payments p
      JOIN gigs g ON p.gig_id = g.id
      JOIN users u ON p.student_id = u.id
      WHERE p.employer_id = ?
      ORDER BY p.created_at DESC
    `).all(req.user.id);

    res.json(payments);
  } catch (err) {
    console.error('Get employer payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments.' });
  }
});

// Get student's payments
router.get('/student', authenticate, requireRole('student'), (req, res) => {
  try {
    const db = getDb();
    const payments = db.prepare(`
      SELECT p.*, g.title as gig_title, u.full_name as employer_name, ep.company_name
      FROM payments p
      JOIN gigs g ON p.gig_id = g.id
      JOIN users u ON p.employer_id = u.id
      LEFT JOIN employer_profiles ep ON u.id = ep.user_id
      WHERE p.student_id = ?
      ORDER BY p.created_at DESC
    `).all(req.user.id);

    res.json(payments);
  } catch (err) {
    console.error('Get student payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments.' });
  }
});

// Submit review after payment
router.post('/review', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { gig_id, reviewee_id, rating, comment } = req.body;
    if (!gig_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'Gig ID, reviewee ID, and rating are required.' });
    }

    // Check payment is completed
    const payment = db.prepare("SELECT * FROM payments WHERE gig_id = ? AND status = 'completed' AND (employer_id = ? OR student_id = ?)")
      .get(gig_id, req.user.id, req.user.id);
    if (!payment) return res.status(400).json({ error: 'Can only review after completed payment.' });

    // Check not reviewing self
    if (req.user.id === reviewee_id) return res.status(400).json({ error: 'Cannot review yourself.' });

    db.prepare('INSERT INTO reviews (gig_id, reviewer_id, reviewee_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
      .run(gig_id, req.user.id, reviewee_id, rating, comment || null);

    res.status(201).json({ message: 'Review submitted successfully!' });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
});

module.exports = router;
