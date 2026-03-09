const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Get all gigs (public with filters)
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { category, location_type, search, min_pay, max_pay, status, page = 1, limit = 12 } = req.query;
    let query = `
      SELECT g.*, u.full_name as employer_name, ep.company_name, ep.verified,
      (SELECT COUNT(*) FROM applications WHERE gig_id = g.id) as application_count
      FROM gigs g
      JOIN users u ON g.employer_id = u.id
      LEFT JOIN employer_profiles ep ON u.id = ep.user_id
      WHERE 1=1
    `;
    const params = [];

    if (category) { query += ' AND g.category = ?'; params.push(category); }
    if (location_type) { query += ' AND g.location_type = ?'; params.push(location_type); }
    if (status) { query += ' AND g.status = ?'; params.push(status); }
    else { query += " AND g.status = 'open'"; }
    if (min_pay) { query += ' AND g.pay_amount >= ?'; params.push(Number(min_pay)); }
    if (max_pay) { query += ' AND g.pay_amount <= ?'; params.push(Number(max_pay)); }
    if (search) {
      query += ' AND (g.title LIKE ? OR g.description LIKE ? OR g.skills_required LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    query += ' ORDER BY g.created_at DESC';

    const offset = (Number(page) - 1) * Number(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    const gigs = db.prepare(query).all(...params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM gigs g WHERE 1=1`;
    const countParams = [];
    if (category) { countQuery += ' AND g.category = ?'; countParams.push(category); }
    if (location_type) { countQuery += ' AND g.location_type = ?'; countParams.push(location_type); }
    if (status) { countQuery += ' AND g.status = ?'; countParams.push(status); }
    else { countQuery += " AND g.status = 'open'"; }
    if (min_pay) { countQuery += ' AND g.pay_amount >= ?'; countParams.push(Number(min_pay)); }
    if (max_pay) { countQuery += ' AND g.pay_amount <= ?'; countParams.push(Number(max_pay)); }
    if (search) {
      countQuery += ' AND (g.title LIKE ? OR g.description LIKE ? OR g.skills_required LIKE ?)';
      const s = `%${search}%`;
      countParams.push(s, s, s);
    }
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({ gigs, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error('Get gigs error:', err);
    res.status(500).json({ error: 'Failed to fetch gigs.' });
  }
});

// Get single gig
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const gig = db.prepare(`
      SELECT g.*, u.full_name as employer_name, u.email as employer_email,
      ep.company_name, ep.company_description, ep.verified, ep.website, ep.location as company_location,
      (SELECT COUNT(*) FROM applications WHERE gig_id = g.id) as application_count,
      (SELECT AVG(rating) FROM reviews WHERE reviewee_id = g.employer_id) as employer_rating
      FROM gigs g
      JOIN users u ON g.employer_id = u.id
      LEFT JOIN employer_profiles ep ON u.id = ep.user_id
      WHERE g.id = ?
    `).get(req.params.id);

    if (!gig) return res.status(404).json({ error: 'Gig not found.' });
    res.json(gig);
  } catch (err) {
    console.error('Get gig error:', err);
    res.status(500).json({ error: 'Failed to fetch gig.' });
  }
});

// Create gig (employer only)
router.post('/', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const { title, description, category, skills_required, location, location_type, pay_amount, pay_type, duration, deadline, max_applicants } = req.body;

    if (!title || !description || !category || !pay_amount) {
      return res.status(400).json({ error: 'Title, description, category, and pay amount are required.' });
    }

    const result = db.prepare(`
      INSERT INTO gigs (employer_id, title, description, category, skills_required, location, location_type, pay_amount, pay_type, duration, deadline, max_applicants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, title, description, category,
      skills_required || null, location || null, location_type || 'remote',
      pay_amount, pay_type || 'fixed', duration || null, deadline || null,
      max_applicants || 10
    );

    const gig = db.prepare('SELECT * FROM gigs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Gig posted successfully!', gig });
  } catch (err) {
    console.error('Create gig error:', err);
    res.status(500).json({ error: 'Failed to create gig.' });
  }
});

// Update gig
router.put('/:id', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND employer_id = ?').get(req.params.id, req.user.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found or unauthorized.' });

    const { title, description, category, skills_required, location, location_type, pay_amount, pay_type, duration, deadline, max_applicants, status } = req.body;

    db.prepare(`
      UPDATE gigs SET title = ?, description = ?, category = ?, skills_required = ?, location = ?, location_type = ?, pay_amount = ?, pay_type = ?, duration = ?, deadline = ?, max_applicants = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND employer_id = ?
    `).run(
      title || gig.title, description || gig.description, category || gig.category,
      skills_required || gig.skills_required, location || gig.location,
      location_type || gig.location_type, pay_amount || gig.pay_amount,
      pay_type || gig.pay_type, duration || gig.duration, deadline || gig.deadline,
      max_applicants || gig.max_applicants, status || gig.status,
      req.params.id, req.user.id
    );

    const updated = db.prepare('SELECT * FROM gigs WHERE id = ?').get(req.params.id);
    res.json({ message: 'Gig updated successfully!', gig: updated });
  } catch (err) {
    console.error('Update gig error:', err);
    res.status(500).json({ error: 'Failed to update gig.' });
  }
});

// Delete gig
router.delete('/:id', authenticate, requireRole('employer'), (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM gigs WHERE id = ? AND employer_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Gig not found or unauthorized.' });
    res.json({ message: 'Gig deleted successfully.' });
  } catch (err) {
    console.error('Delete gig error:', err);
    res.status(500).json({ error: 'Failed to delete gig.' });
  }
});

module.exports = router;
