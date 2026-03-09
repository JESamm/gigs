const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Public platform stats (no auth required)
router.get('/public-stats', (req, res) => {
  try {
    const db = getDb();
    const openGigs = db.prepare("SELECT COUNT(*) as count FROM gigs WHERE status = 'open'").get().count;
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const totalEmployers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'employer'").get().count;
    const completedGigs = db.prepare("SELECT COUNT(*) as count FROM gigs WHERE status = 'completed'").get().count;
    res.json({ openGigs, totalStudents, totalEmployers, completedGigs });
  } catch (err) {
    console.error('Public stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// Dashboard stats
router.get('/stats', authenticate, (req, res) => {
  try {
    const db = getDb();
    if (req.user.role === 'employer') {
      const totalGigs = db.prepare('SELECT COUNT(*) as count FROM gigs WHERE employer_id = ?').get(req.user.id).count;
      const activeGigs = db.prepare("SELECT COUNT(*) as count FROM gigs WHERE employer_id = ? AND status = 'open'").get(req.user.id).count;
      const totalApplicants = db.prepare('SELECT COUNT(*) as count FROM applications a JOIN gigs g ON a.gig_id = g.id WHERE g.employer_id = ?').get(req.user.id).count;
      const totalSpent = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE employer_id = ? AND status = 'completed'").get(req.user.id).total;
      const pendingPayments = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE employer_id = ? AND status = 'pending'").get(req.user.id).total;
      const completedGigs = db.prepare("SELECT COUNT(*) as count FROM gigs WHERE employer_id = ? AND status = 'completed'").get(req.user.id).count;

      const recentApplications = db.prepare(`
        SELECT a.*, u.full_name as student_name, u.avatar_url as student_avatar, sp.school_name, g.title as gig_title
        FROM applications a
        JOIN users u ON a.student_id = u.id
        LEFT JOIN student_profiles sp ON u.id = sp.user_id
        JOIN gigs g ON a.gig_id = g.id
        WHERE g.employer_id = ? AND a.status = 'pending'
        ORDER BY a.created_at DESC LIMIT 5
      `).all(req.user.id);

      res.json({ totalGigs, activeGigs, totalApplicants, totalSpent, pendingPayments, completedGigs, recentApplications });
    } else {
      const appliedGigs = db.prepare('SELECT COUNT(*) as count FROM applications WHERE student_id = ?').get(req.user.id).count;
      const acceptedGigs = db.prepare("SELECT COUNT(*) as count FROM applications WHERE student_id = ? AND status = 'accepted'").get(req.user.id).count;
      const totalEarned = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE student_id = ? AND status = 'completed'").get(req.user.id).total;
      const pendingPayments = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE student_id = ? AND status = 'pending'").get(req.user.id).total;
      const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(req.user.id);

      const recentGigs = db.prepare(`
        SELECT g.*, u.full_name as employer_name, ep.company_name,
        (SELECT COUNT(*) FROM applications WHERE gig_id = g.id) as application_count
        FROM gigs g
        JOIN users u ON g.employer_id = u.id
        LEFT JOIN employer_profiles ep ON u.id = ep.user_id
        WHERE g.status = 'open'
        ORDER BY g.created_at DESC LIMIT 6
      `).all();

      res.json({ appliedGigs, acceptedGigs, totalEarned, pendingPayments, profile, recentGigs });
    }
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data.' });
  }
});

module.exports = router;
