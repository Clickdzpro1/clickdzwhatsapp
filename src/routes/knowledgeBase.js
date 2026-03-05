const express = require('express');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/knowledge-base
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM knowledge_base WHERE tenant_id = $1 ORDER BY category, title',
      [req.tenant.id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/knowledge-base
router.post('/', async (req, res, next) => {
  try {
    const { title, content, category } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const result = await query(
      `INSERT INTO knowledge_base (tenant_id, title, content, category)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.tenant.id, title, content, category || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/knowledge-base/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, content, category, isActive } = req.body;
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (title !== undefined) { updates.push(`title = $${paramIdx++}`); params.push(title); }
    if (content !== undefined) { updates.push(`content = $${paramIdx++}`); params.push(content); }
    if (category !== undefined) { updates.push(`category = $${paramIdx++}`); params.push(category); }
    if (isActive !== undefined) { updates.push(`is_active = $${paramIdx++}`); params.push(isActive); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id, req.tenant.id);
    const result = await query(
      `UPDATE knowledge_base SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/knowledge-base/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM knowledge_base WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
