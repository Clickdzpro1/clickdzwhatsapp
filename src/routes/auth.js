const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateToken, generateRefreshToken, authenticate } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, phone, password, name, businessName, businessType } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone is required' });
    }

    // Check if already exists
    if (email) {
      const existing = await query('SELECT id FROM tenants WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }
    if (phone) {
      const existing = await query('SELECT id FROM tenants WHERE phone = $1', [phone]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Phone already registered' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO tenants (email, phone, password_hash, name, business_name, business_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, phone, name, plan, status`,
      [email || null, phone || null, passwordHash, name, businessName || null, businessType || null]
    );

    const tenant = result.rows[0];
    const token = generateToken({ tenantId: tenant.id, email: tenant.email });
    const refreshToken = generateRefreshToken({ tenantId: tenant.id });

    // Save refresh token
    await query(
      `INSERT INTO sessions (tenant_id, refresh_token, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
      [tenant.id, refreshToken, req.headers['user-agent'], req.ip]
    );

    logger.info(`New tenant registered: ${tenant.id}`);

    res.status(201).json({
      tenant: {
        id: tenant.id,
        email: tenant.email,
        phone: tenant.phone,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
      },
      token,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, phone, password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    let result;
    if (email) {
      result = await query('SELECT * FROM tenants WHERE email = $1', [email]);
    } else if (phone) {
      result = await query('SELECT * FROM tenants WHERE phone = $1', [phone]);
    } else {
      return res.status(400).json({ error: 'Email or phone is required' });
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tenant = result.rows[0];
    const valid = await bcrypt.compare(password, tenant.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (tenant.status === 'cancelled') {
      return res.status(403).json({ error: 'Account has been cancelled' });
    }

    const token = generateToken({ tenantId: tenant.id, email: tenant.email });
    const refreshToken = generateRefreshToken({ tenantId: tenant.id });

    await query(
      `INSERT INTO sessions (tenant_id, refresh_token, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
      [tenant.id, refreshToken, req.headers['user-agent'], req.ip]
    );

    res.json({
      tenant: {
        id: tenant.id,
        email: tenant.email,
        phone: tenant.phone,
        name: tenant.name,
        businessName: tenant.business_name,
        plan: tenant.plan,
        status: tenant.status,
        whatsappConnected: tenant.whatsapp_connected,
      },
      token,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const session = await query(
      'SELECT * FROM sessions WHERE refresh_token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const tenantId = session.rows[0].tenant_id;
    const tenant = await query('SELECT id, email FROM tenants WHERE id = $1', [tenantId]);

    const newToken = generateToken({ tenantId, email: tenant.rows[0].email });
    res.json({ token: newToken });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, phone, name, business_name, business_type, plan, status,
              whatsapp_connected, trial_budget_remaining, ai_tokens_used, messages_processed,
              settings, created_at
       FROM tenants WHERE id = $1`,
      [req.tenant.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const t = result.rows[0];
    res.json({
      id: t.id,
      email: t.email,
      phone: t.phone,
      name: t.name,
      businessName: t.business_name,
      businessType: t.business_type,
      plan: t.plan,
      status: t.status,
      whatsappConnected: t.whatsapp_connected,
      trialBudgetRemaining: parseFloat(t.trial_budget_remaining),
      aiTokensUsed: t.ai_tokens_used,
      messagesProcessed: t.messages_processed,
      settings: t.settings,
      createdAt: t.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM sessions WHERE refresh_token = $1 AND tenant_id = $2', [refreshToken, req.tenant.id]);
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
