const { Pool } = require('pg');
const config = require('./index');
const logger = require('./logger');

const pool = new Pool({
  connectionString: config.db.connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', err);
});

// Helper: run query with automatic tenant isolation
const query = (text, params) => pool.query(text, params);

// Helper: get a client for transactions
const getClient = () => pool.connect();

// Helper: run a query scoped to a tenant
const tenantQuery = async (tenantId, text, params = []) => {
  // Prepend tenant_id to params if query contains $tenant placeholder
  if (text.includes('$tenant')) {
    text = text.replace(/\$tenant/g, `$${params.length + 1}`);
    params.push(tenantId);
  }
  return pool.query(text, params);
};

module.exports = { pool, query, getClient, tenantQuery };
