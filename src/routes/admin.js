const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticateAdmin, generateToken } = require('../middleware/auth');
const bridgeManager = require('../services/whatsapp/manager');

const router = express.Router();

// POST /api/admin/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM admins WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken({ adminId: admin.id, role: admin.role, isAdmin: true });
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role }, token });
  } catch (err) {
    next(err);
  }
});

// All routes below require admin auth
router.use(authenticateAdmin);

// GET /api/admin/tenants — list all tenants
router.get('/tenants', async (req, res, next) => {
  try {
    const { status, plan, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'TRUE';
    const params = [];
    let paramIdx = 1;

    if (status) { where += ` AND status = $${paramIdx++}`; params.push(status); }
    if (plan) { where += ` AND plan = $${paramIdx++}`; params.push(plan); }
    if (search) {
      where += ` AND (name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR business_name ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const result = await query(
      `SELECT id, name, email, phone, business_name, plan, status, whatsapp_connected,
              ai_tokens_used, messages_processed, trial_budget_remaining, created_at
       FROM tenants WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const count = await query(`SELECT COUNT(*) FROM tenants WHERE ${where}`, params);

    res.json({ tenants: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/tenants/:id — tenant detail
router.get('/tenants/:id', async (req, res, next) => {
  try {
    const tenant = await query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const t = tenant.rows[0];
    delete t.password_hash;

    // Get subscription info
    const sub = await query(
      "SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [req.params.id]
    );

    // Get usage last 7 days
    const usage = await query(
      `SELECT * FROM usage_daily WHERE tenant_id = $1 AND date >= NOW() - INTERVAL '7 days' ORDER BY date ASC`,
      [req.params.id]
    );

    res.json({ tenant: t, subscription: sub.rows[0] || null, usage: usage.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/tenants/:id — update tenant (suspend, change plan, etc.)
router.patch('/tenants/:id', async (req, res, next) => {
  try {
    const { status, plan, trialBudgetRemaining } = req.body;
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (status !== undefined) { updates.push(`status = $${paramIdx++}`); params.push(status); }
    if (plan !== undefined) { updates.push(`plan = $${paramIdx++}`); params.push(plan); }
    if (trialBudgetRemaining !== undefined) { updates.push(`trial_budget_remaining = $${paramIdx++}`); params.push(trialBudgetRemaining); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    const result = await query(
      `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, name, email, plan, status`,
      params
    );

    // If suspended, stop their bridge
    if (status === 'suspended') {
      await bridgeManager.stopBridge(req.params.id);
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats — platform-wide stats
router.get('/stats', async (req, res, next) => {
  try {
    const [tenantStats, bridgeStats, revenueStats, usageStats] = await Promise.all([
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
        COUNT(*) FILTER (WHERE plan = 'trial') as trial,
        COUNT(*) FILTER (WHERE plan = 'weekly') as weekly,
        COUNT(*) FILTER (WHERE whatsapp_connected = true) as connected
       FROM tenants`),
      Promise.resolve(bridgeManager.getStats()),
      query(`SELECT
        COUNT(*) as total_payments,
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '7 days'), 0) as weekly_revenue
       FROM payments`),
      query(`SELECT
        COALESCE(SUM(ai_tokens_used), 0) as total_tokens,
        COALESCE(SUM(messages_received), 0) as total_messages,
        COALESCE(SUM(cost_usd), 0) as total_cost
       FROM usage_daily WHERE date >= NOW() - INTERVAL '7 days'`),
    ]);

    res.json({
      tenants: tenantStats.rows[0],
      bridges: bridgeStats,
      revenue: revenueStats.rows[0],
      weeklyUsage: usageStats.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/impersonate/:tenantId — get token for tenant
router.post('/impersonate/:tenantId', async (req, res, next) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin required' });
    }

    const tenant = await query('SELECT id, email FROM tenants WHERE id = $1', [req.params.tenantId]);
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const token = generateToken({
      tenantId: tenant.rows[0].id,
      email: tenant.rows[0].email,
      impersonatedBy: req.admin.id,
    }, '1h');

    res.json({ token, expiresIn: '1h' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
