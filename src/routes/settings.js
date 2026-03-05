const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/settings
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT settings, name, business_name, business_type, email, phone FROM tenants WHERE id = $1',
      [req.tenant.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/settings
router.patch('/', async (req, res, next) => {
  try {
    const { name, businessName, businessType, settings } = req.body;
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
    if (businessName !== undefined) { updates.push(`business_name = $${paramIdx++}`); params.push(businessName); }
    if (businessType !== undefined) { updates.push(`business_type = $${paramIdx++}`); params.push(businessType); }
    if (settings !== undefined) { updates.push(`settings = settings || $${paramIdx++}::jsonb`); params.push(JSON.stringify(settings)); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.tenant.id);
    const result = await query(
      `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING settings, name, business_name, business_type`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/settings/password
router.patch('/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const tenant = await query('SELECT password_hash FROM tenants WHERE id = $1', [req.tenant.id]);
    const valid = await bcrypt.compare(currentPassword, tenant.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE tenants SET password_hash = $1 WHERE id = $2', [hash, req.tenant.id]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

// Service status management
// GET /api/settings/service-status
router.get('/service-status', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM service_status WHERE tenant_id = $1 ORDER BY updated_at DESC',
      [req.tenant.id]
    );
    res.json({ services: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/service-status
router.post('/service-status', async (req, res, next) => {
  try {
    const { serviceName, status, message } = req.body;
    if (!serviceName) return res.status(400).json({ error: 'Service name is required' });

    const result = await query(
      `INSERT INTO service_status (tenant_id, service_name, status, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.tenant.id, serviceName, status || 'operational', message || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/settings/service-status/:id
router.patch('/service-status/:id', async (req, res, next) => {
  try {
    const { status, message } = req.body;
    const result = await query(
      `UPDATE service_status SET status = COALESCE($1, status), message = COALESCE($2, message), updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [status, message, req.params.id, req.tenant.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
