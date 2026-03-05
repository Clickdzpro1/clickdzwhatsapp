const express = require('express');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/templates
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM reply_templates WHERE tenant_id = $1 ORDER BY usage_count DESC',
      [req.tenant.id]
    );
    res.json({ templates: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/templates
router.post('/', async (req, res, next) => {
  try {
    const { shortcut, title, content, category } = req.body;
    if (!shortcut || !title || !content) {
      return res.status(400).json({ error: 'Shortcut, title, and content are required' });
    }

    const result = await query(
      `INSERT INTO reply_templates (tenant_id, shortcut, title, content, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.tenant.id, shortcut, title, content, category || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Shortcut already exists' });
    next(err);
  }
});

// PATCH /api/templates/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { shortcut, title, content, category } = req.body;
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (shortcut !== undefined) { updates.push(`shortcut = $${paramIdx++}`); params.push(shortcut); }
    if (title !== undefined) { updates.push(`title = $${paramIdx++}`); params.push(title); }
    if (content !== undefined) { updates.push(`content = $${paramIdx++}`); params.push(content); }
    if (category !== undefined) { updates.push(`category = $${paramIdx++}`); params.push(category); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id, req.tenant.id);
    const result = await query(
      `UPDATE reply_templates SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/templates/:id/use — track usage
router.post('/:id/use', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE reply_templates SET usage_count = usage_count + 1
       WHERE id = $1 AND tenant_id = $2 RETURNING content`,
      [req.params.id, req.tenant.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ content: result.rows[0].content });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM reply_templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
