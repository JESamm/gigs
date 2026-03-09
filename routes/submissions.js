const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Configure multer for task file uploads
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'submissions');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `sub-${req.user.id}-${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max per file
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx',
      '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z', '.txt', '.csv',
      '.mp4', '.mp3', '.py', '.js', '.html', '.css', '.json', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not allowed. Supported: images, documents, archives, code files.`));
    }
  }
});

// Submit work for a gig (student only)
router.post('/', authenticate, requireRole('student'), (req, res) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 20MB per file.' });
      }
      return res.status(400).json({ error: err.message });
    }

    try {
      const db = getDb();
      const { gig_id, description } = req.body;

      if (!gig_id) return res.status(400).json({ error: 'Gig ID is required.' });
      if (!description && (!req.files || req.files.length === 0)) {
        return res.status(400).json({ error: 'Please provide a description or upload at least one file.' });
      }

      // Verify student is accepted for this gig
      const application = db.prepare(`
        SELECT a.id FROM applications a
        JOIN gigs g ON a.gig_id = g.id
        WHERE a.gig_id = ? AND a.student_id = ? AND a.status = 'accepted'
        AND g.status = 'in_progress'
      `).get(gig_id, req.user.id);

      if (!application) {
        return res.status(403).json({ error: 'You must be the accepted student on an active gig to submit work.' });
      }

      // Build file URLs
      const fileUrls = req.files && req.files.length > 0
        ? req.files.map(f => `/uploads/submissions/${f.filename}`).join(',')
        : null;

      const result = db.prepare(
        'INSERT INTO submissions (gig_id, student_id, description, file_urls) VALUES (?, ?, ?, ?)'
      ).run(gig_id, req.user.id, description || null, fileUrls);

      // Notify employer
      const gig = db.prepare('SELECT title, employer_id FROM gigs WHERE id = ?').get(gig_id);
      if (gig) {
        db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
          .run(gig.employer_id, 'Work Submitted! 📦',
            `${req.user.full_name} submitted work for "${gig.title}". Review it now.`,
            'info', `/gig/${gig_id}`);
      }

      res.status(201).json({
        message: 'Work submitted successfully!',
        submission: {
          id: result.lastInsertRowid,
          gig_id: Number(gig_id),
          description,
          file_urls: fileUrls ? fileUrls.split(',') : [],
          status: 'submitted'
        }
      });
    } catch (err) {
      console.error('Submit work error:', err);
      res.status(500).json({ error: 'Failed to submit work.' });
    }
  });
});

// Get submissions for a gig (employer who owns it, or the student who submitted)
router.get('/gig/:gigId', authenticate, (req, res) => {
  try {
    const db = getDb();
    const gigId = req.params.gigId;

    // Verify access: must be the employer who owns the gig or the accepted student
    const gig = db.prepare('SELECT * FROM gigs WHERE id = ?').get(gigId);
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });

    const isEmployer = gig.employer_id === req.user.id;
    const isStudent = req.user.role === 'student';

    if (!isEmployer && !isStudent) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    let query;
    let params;
    if (isStudent) {
      query = `SELECT s.*, u.full_name as student_name, u.avatar_url as student_avatar
        FROM submissions s JOIN users u ON s.student_id = u.id
        WHERE s.gig_id = ? AND s.student_id = ? ORDER BY s.created_at DESC`;
      params = [gigId, req.user.id];
    } else {
      query = `SELECT s.*, u.full_name as student_name, u.avatar_url as student_avatar
        FROM submissions s JOIN users u ON s.student_id = u.id
        WHERE s.gig_id = ? ORDER BY s.created_at DESC`;
      params = [gigId];
    }

    const submissions = db.prepare(query).all(...params);

    // Parse file_urls from comma-separated to array
    const parsed = submissions.map(s => ({
      ...s,
      file_urls: s.file_urls ? s.file_urls.split(',') : []
    }));

    res.json({ submissions: parsed, gig_title: gig.title, gig_status: gig.status });
  } catch (err) {
    console.error('Get submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions.' });
  }
});

// Review a submission (employer only — approve, request revision, or reject)
router.put('/:id/review', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const { status, feedback } = req.body;

    if (!['approved', 'revision_requested', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved, revision_requested, or rejected.' });
    }

    const submission = db.prepare(`
      SELECT s.*, g.employer_id, g.title as gig_title, g.id as gig_id
      FROM submissions s JOIN gigs g ON s.gig_id = g.id
      WHERE s.id = ? AND g.employer_id = ?
    `).get(req.params.id, req.user.id);

    if (!submission) return res.status(404).json({ error: 'Submission not found or unauthorized.' });

    db.prepare('UPDATE submissions SET status = ?, employer_feedback = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, feedback || null, req.params.id);

    // Notify student
    const messages = {
      approved: { title: 'Work Approved! ✅', msg: `Your submission for "${submission.gig_title}" has been approved!`, type: 'success' },
      revision_requested: { title: 'Revision Requested 🔄', msg: `The employer requested changes on your submission for "${submission.gig_title}".${feedback ? ' Feedback: ' + feedback : ''}`, type: 'warning' },
      rejected: { title: 'Submission Rejected ❌', msg: `Your submission for "${submission.gig_title}" was not accepted.${feedback ? ' Feedback: ' + feedback : ''}`, type: 'error' }
    };

    const notif = messages[status];
    db.prepare('INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)')
      .run(submission.student_id, notif.title, notif.msg, notif.type, `/gig/${submission.gig_id}`);

    res.json({ message: `Submission ${status.replace('_', ' ')} successfully.` });
  } catch (err) {
    console.error('Review submission error:', err);
    res.status(500).json({ error: 'Failed to review submission.' });
  }
});

module.exports = router;
