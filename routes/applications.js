const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Apply for a gig (student only)
router.post('/', authenticate, requireRole('student'), (req, res) => {
  try {
    const db = getDb();
    const { gig_id, cover_letter, proposed_amount } = req.body;

    if (!gig_id) return res.status(400).json({ error: 'Gig ID is required.' });

    const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND status = ?').get(gig_id, 'open');
    if (!gig) return res.status(404).json({ error: 'Gig not found or no longer accepting applications.' });

    // Check if already applied
    const existing = db.prepare('SELECT id FROM applications WHERE gig_id = ? AND student_id = ?').get(gig_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You have already applied for this gig.' });

    // Check max applicants
    const { count } = db.prepare('SELECT COUNT(*) as count FROM applications WHERE gig_id = ?').get(gig_id);
    if (count >= gig.max_applicants) return res.status(400).json({ error: 'This gig has reached the maximum number of applicants.' });

    const result = db.prepare('INSERT INTO applications (gig_id, student_id, cover_letter, proposed_amount) VALUES (?, ?, ?, ?)')
      .run(gig_id, req.user.id, cover_letter || null, proposed_amount || gig.pay_amount);

    // Notify employer
    db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
      .run(gig.employer_id, 'New Application! 📩', `${req.user.full_name} applied for "${gig.title}"`, 'info', `/gig/${gig_id}`);

    res.status(201).json({ message: 'Application submitted successfully!', applicationId: result.lastInsertRowid });
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ error: 'Failed to submit application.' });
  }
});

// Get applications for a gig (employer)
router.get('/gig/:gigId', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND employer_id = ?').get(req.params.gigId, req.user.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found or unauthorized.' });

    const applications = db.prepare(`
      SELECT a.*, u.full_name as student_name, u.email as student_email, u.avatar_url as student_avatar,
      sp.school_name, sp.major, sp.graduation_year, sp.gpa, sp.bio, sp.skills, sp.portfolio_url, sp.total_earned,
      (SELECT AVG(rating) FROM reviews WHERE reviewee_id = a.student_id) as student_rating,
      (SELECT COUNT(*) FROM gigs g JOIN applications ap ON g.id = ap.gig_id WHERE ap.student_id = a.student_id AND ap.status = 'accepted') as completed_gigs
      FROM applications a
      JOIN users u ON a.student_id = u.id
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      WHERE a.gig_id = ?
      ORDER BY a.created_at DESC
    `).all(req.params.gigId);

    res.json(applications);
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

// Get student's applications
router.get('/my', authenticate, requireRole('student'), (req, res) => {
  try {
    const db = getDb();
    const applications = db.prepare(`
      SELECT a.*, g.title as gig_title, g.pay_amount, g.pay_type, g.category, g.status as gig_status,
      u.full_name as employer_name, ep.company_name
      FROM applications a
      JOIN gigs g ON a.gig_id = g.id
      JOIN users u ON g.employer_id = u.id
      LEFT JOIN employer_profiles ep ON u.id = ep.user_id
      WHERE a.student_id = ?
      ORDER BY a.created_at DESC
    `).all(req.user.id);

    res.json(applications);
  } catch (err) {
    console.error('Get my applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

// Update application status (employer)
router.put('/:id/status', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be accepted or rejected.' });
    }

    const application = db.prepare(`
      SELECT a.*, g.employer_id, g.title as gig_title, g.pay_amount
      FROM applications a JOIN gigs g ON a.gig_id = g.id
      WHERE a.id = ? AND g.employer_id = ?
    `).get(req.params.id, req.user.id);

    if (!application) return res.status(404).json({ error: 'Application not found or unauthorized.' });

    db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, req.params.id);

    if (status === 'accepted') {
      db.prepare("UPDATE gigs SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(application.gig_id);

      // Create pending payment
      db.prepare('INSERT INTO payments (gig_id, employer_id, student_id, amount, status) VALUES (?, ?, ?, ?, ?)')
        .run(application.gig_id, req.user.id, application.student_id, application.proposed_amount || application.pay_amount, 'pending');
    }

    // Notify student
    const emoji = status === 'accepted' ? '🎉' : '😔';
    db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
      .run(application.student_id, `Application ${status} ${emoji}`,
        `Your application for "${application.gig_title}" has been ${status}.`,
        status === 'accepted' ? 'success' : 'warning',
        `/gig/${application.gig_id}`
      );

    res.json({ message: `Application ${status} successfully.` });
  } catch (err) {
    console.error('Update application error:', err);
    res.status(500).json({ error: 'Failed to update application.' });
  }
});

// Withdraw application (student)
router.put('/:id/withdraw', authenticate, requireRole('student'), (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare("UPDATE applications SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND student_id = ? AND status = 'pending'")
      .run(req.params.id, req.user.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Application not found or cannot be withdrawn.' });
    res.json({ message: 'Application withdrawn successfully.' });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Failed to withdraw application.' });
  }
});

module.exports = router;
