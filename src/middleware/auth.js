const jwt = require('jsonwebtoken');
const config = require('../config');

// Authenticate tenant JWT
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, config.jwtSecret);
    req.tenant = { id: payload.tenantId, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Authenticate admin JWT
function authenticateAdmin(req, res, next) {
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

// Check tenant is active and not suspended
async function checkTenantActive(req, res, next) {
  const { query } = require('../config/database');
  try {
    const result = await query(
      'SELECT status, plan FROM tenants WHERE id = $1',
      [req.tenant.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    if (result.rows[0].status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Please renew your subscription.' });
    }
    req.tenant.plan = result.rows[0].plan;
    req.tenant.status = result.rows[0].status;
    next();
  } catch (err) {
    next(err);
  }
}

function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function generateRefreshToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

module.exports = { authenticate, authenticateAdmin, checkTenantActive, generateToken, generateRefreshToken };
