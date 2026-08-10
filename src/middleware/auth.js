/**
 * middleware/auth.js (Wave 1)
 *
 * Adds `req.user.id` and `req.tenant.role` to every authenticated request,
 * and a new `requireInstanceAccess` middleware that 404s if the calling user
 * does not appear in `whatsapp_instance_acl` for the instance they want to
 * touch. The legacy `authenticate` function still passes when only a
 * tenant JWT is present (back-compat with the Wave 1 JWT format that
 * gained a user_id field).
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../config/database');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, config.jwtSecret);
    req.tenant = { id: payload.tenantId, email: payload.email };
    req.user = payload.userId
      ? { id: payload.userId, role: payload.role || 'agent', email: payload.email }
      : null;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function authenticateAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, config.jwtSecret);
    if (!payload.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = { id: payload.adminId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function checkTenantActive(req, res, next) {
  try {
    const result = await query('SELECT status, plan FROM tenants WHERE id = $1', [req.tenant.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    if (result.rows[0].status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Please renew your subscription.' });
    }
    req.tenant.plan = result.rows[0].plan;
    req.tenant.status = result.rows[0].status;
    next();
  } catch (err) { next(err); }
}

/**
 * ACL middleware: gates /api/whatsapp/instances/:id by user membership in
 * whatsapp_instance_acl. Owners and admins always pass. Agents and viewers
 * must have an explicit row.
 *
 * Loads the instance once into req.instance so the route handler doesn't
 * re-query.
 */
async function requireInstanceAccess(req, res, next) {
  const instanceId = req.params.id || req.params.instanceId;
  if (!instanceId) {
    return res.status(400).json({ error: 'instance id required' });
  }
  try {
    const inst = await query(
      'SELECT * FROM whatsapp_instances WHERE tenant_id = $1 AND id = $2',
      [req.tenant.id, instanceId],
    );
    if (!inst.rows[0]) return res.status(404).json({ error: 'instance not found' });
    req.instance = inst.rows[0];

    // Tenant-level admin (e.g. tenant rows in admins) bypass ACL.
    if (req.user && req.user.role === 'owner') return next();

    // Instance-level admin always passes.
    if (req.user && req.user.id === inst.rows[0].owner_user_id) return next();

    // Otherwise require an ACL row.
    // user_id may be null on legacy tokens → fail closed.
    if (!req.user) return res.status(403).json({ error: 'user context required for this instance' });
    const acl = await query(
      'SELECT role FROM whatsapp_instance_acl WHERE instance_id = $1 AND user_id = $2',
      [instanceId, req.user.id],
    );
    if (!acl.rows[0]) return res.status(403).json({ error: 'no access to this WhatsApp account' });
    req.instance.role = acl.rows[0].role;
    return next();
  } catch (err) { next(err); }
}

function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function generateRefreshToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

module.exports = {
  authenticate,
  authenticateAdmin,
  checkTenantActive,
  requireInstanceAccess,
  generateToken,
  generateRefreshToken,
};
