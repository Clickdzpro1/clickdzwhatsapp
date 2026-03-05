const express = require('express');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/contacts
router.get('/', async (req, res, next) => {
  try {
    const { search, clientType, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'tenant_id = $1';
    const params = [req.tenant.id];
    let paramIdx = 2;

    if (search) {
      where += ` AND (name ILIKE $${paramIdx} OR push_name ILIKE $${paramIdx} OR phone ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (clientType) {
      where += ` AND client_type = $${paramIdx++}`;
      params.push(clientType);
    }

    const result = await query(
      `SELECT * FROM contacts WHERE ${where} ORDER BY last_message_at DESC NULLS LAST LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const count = await query(`SELECT COUNT(*) FROM contacts WHERE ${where}`, params);

    res.json({ contacts: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/contacts/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, clientType, tags, notes, metadata } = req.body;
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
    if (clientType !== undefined) { updates.push(`client_type = $${paramIdx++}`); params.push(clientType); }
    if (tags !== undefined) { updates.push(`tags = $${paramIdx++}`); params.push(tags); }
    if (notes !== undefined) { updates.push(`notes = $${paramIdx++}`); params.push(notes); }
    if (metadata !== undefined) { updates.push(`metadata = $${paramIdx++}`); params.push(JSON.stringify(metadata)); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id, req.tenant.id);
    const result = await query(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/:id/conversations
router.get('/:id/conversations', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM conversations WHERE contact_id = $1 AND tenant_id = $2 ORDER BY updated_at DESC`,
      [req.params.id, req.tenant.id]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
