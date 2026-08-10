const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateToken, generateRefreshToken, authenticate } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// Helper: fetch (or create) the "owner" user for a tenant. Owner has full
// admin rights — they can connect/disconnect any WhatsApp, grant ACL, etc.
async function loadOrCreateOwnerUser(tenantId, email) {
  if (!email) {
    // Pick the first existing user for this tenant as the owner. Tenant
    // existed pre-Wave-1, so the migration backfilled one already.
    const r = await query(
      `SELECT id, role FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    return r.rows[0] || null;
  }
  const found = await query(
    `SELECT id, role FROM users WHERE tenant_id = $1 AND email = $2`,
    [tenantId, email],
  );
  if (found.rows[0]) return found.rows[0];
  // Create a new owner with empty password hash (delegated auth lives in the
  // tenant row; user-level passwords ship in a future wave).
  const inserted = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, role)
     VALUES ($1, $2, '', NULL, 'owner')
     RETURNING id, role`,
    [tenantId, email],
  );
  return inserted.rows[0];
}

// Issue a token with user_id + role so /v2/* routes can enforce ACL.
async function issueTokensForTenant(tenant, user, req) {
  const token = generateToken({
    tenantId: tenant.id,
    userId: user ? user.id : null,
    role: user ? user.role : 'agent',
    email: tenant.email,
  });
  const refreshToken = generateRefreshToken({
    tenantId: tenant.id,
    userId: user ? user.id : null,
  });
  await query(
    `INSERT INTO sessions (tenant_id, refresh_token, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')
     ON CONFLICT DO NOTHING`,
    [tenant.id, refreshToken, req.headers['user-agent'], req.ip],
  );
  return { token, refreshToken };
}

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
    if (email) {
      const existing = await query('SELECT id FROM tenants WHERE email = $1', [email]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    }
    if (phone) {
      const existing = await query('SELECT id FROM tenants WHERE phone = $1', [phone]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Phone already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO tenants (email, phone, password_hash, name, business_name, business_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, phone, name, plan, status`,
      [email || null, phone || null, passwordHash, name, businessName || null, businessType || null],
    );
    const tenant = result.rows[0];

    // Auto-create the owner user for this tenant — the registration email
    // becomes the workspace owner's login.
    const user = await loadOrCreateOwnerUser(tenant.id, tenant.email);
    const { token, refreshToken } = await issueTokensForTenant(tenant, user, req);

    logger.info(`New tenant registered: ${tenant.id} (owner user ${user && user.id})`);
    res.status(201).json({
      tenant: {
        id: tenant.id,
        email: tenant.email,
        phone: tenant.phone,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
      },
      user: user ? { id: user.id, email: tenant.email, role: user.role } : null,
      token,
      refreshToken,
    });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, phone, password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required' });
    let result;
    if (email) {
      result = await query('SELECT * FROM tenants WHERE email = $1', [email]);
    } else if (phone) {
      result = await query('SELECT * FROM tenants WHERE phone = $1', [phone]);
    } else {
      return res.status(400).json({ error: 'Email or phone is required' });
    }
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const tenant = result.rows[0];
    const valid = await bcrypt.compare(password, tenant.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (tenant.status === 'cancelled') return res.status(403).json({ error: 'Account has been cancelled' });

    const user = await loadOrCreateOwnerUser(tenant.id, tenant.email);
    const { token, refreshToken } = await issueTokensForTenant(tenant, user, req);

    res.json({
      tenant: {
        id: tenant.id,
        email: tenant.email,
        phone: tenant.phone,
        name: tenant.name,
      },
      user: user ? { id: user.id, email: tenant.email, role: user.role } : null,
      token,
      refreshToken,
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh (kept for backwards-compat with Wave 0 tokens)
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    const r = await query(
      `SELECT t.*, u.id AS user_id, u.role AS user_role
       FROM sessions s
       JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN users u ON u.tenant_id = t.id AND u.email = t.email
       WHERE s.refresh_token = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [refreshToken],
    );
    if (!r.rows[0]) return res.status(401).json({ error: 'invalid refresh token' });
    const t = r.rows[0];
    const newToken = generateToken({
      tenantId: t.id,
      userId: t.user_id,
      role: t.user_role || 'owner',
      email: t.email,
    });
    res.json({ token: newToken });
  } catch (err) { next(err); }
});

// GET /api/auth/me (used by the React page to verify the session)
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT t.id, t.email, t.name, t.phone, t.plan, t.status,
              u.id AS user_id, u.role AS user_role
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.email = t.email
       WHERE t.id = $1`,
      [req.tenant.id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'tenant not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
