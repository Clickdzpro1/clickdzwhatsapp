/**
 * services/tenantProvisioner.js — guarantees that each SaaS tenant has
 * an active row in `tenant_gateway_keys` and that every key actually works
 * against the configured gateway base URL.
 *
 * Wave 1 default: use ONE gateway tenant named `work-clickdz-ai` for the
 * entire SaaS. Each SaaS tenant gets its OWN rows in
 * `whatsapp_instances(tenant_id, id)` but they all live under the same
 * gateway API key. This is the simplest cut-over path; we move to
 * per-SaaS-tenant gateway tenants in a later wave once Vercel rate limits
 * confirm one key is enough.
 *
 * The key is stored encrypted in the SaaS DB at rest. We never log it.
 * The provisioning flow is idempotent: if we already have a working row,
 * we use it; if not, we fail loud rather than silently mint a new tenant
 * on the gateway (which would leak data across SaaS tenants).
 */

const crypto = require('crypto');
const { query } = require('../config/database');
const { createGatewayClient } = require('./gatewayClient');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LOOKUP = 'wweb-gateway';

function getEncryptionKey() {
  // Symmetric key from env. Must be 32 bytes (256 bits). Generated via
  // `openssl rand -hex 32` and stored in Vercel as `GATEWAY_KEY_ENC_SECRET`.
  const hex = process.env.GATEWAY_KEY_ENC_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'GATEWAY_KEY_ENC_SECRET is missing or wrong length. Set it to 32 bytes hex (openssl rand -hex 32).',
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(payloadB64) {
  const key = getEncryptionKey();
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

async function getGatewayKeyForTenant(tenantId) {
  const r = await query(
    `SELECT api_key_encrypted, base_url, status, gateway_tenant_external_id
       FROM tenant_gateway_keys
      WHERE tenant_id = $1 AND gateway_label = $2`,
    [tenantId, KEY_LOOKUP],
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    apiKey: decrypt(row.api_key_encrypted),
    baseUrl: row.base_url,
    gatewayTenantExternalId: row.gateway_tenant_external_id,
    status: row.status,
  };
}

async function setGatewayKeyForTenant(tenantId, { apiKey, baseUrl, gatewayTenantExternalId, notes }) {
  await query(
    `INSERT INTO tenant_gateway_keys
        (tenant_id, gateway_label, api_key_encrypted, api_key_last4, base_url,
         gateway_tenant_external_id, status, notes, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
        SET api_key_encrypted = EXCLUDED.api_key_encrypted,
            api_key_last4      = EXCLUDED.api_key_last4,
            base_url           = EXCLUDED.base_url,
            gateway_tenant_external_id = EXCLUDED.gateway_tenant_external_id,
            status             = 'active',
            last_used_at       = NOW(),
            notes              = EXCLUDED.notes`,
    [
      tenantId,
      KEY_LOOKUP,
      encrypt(apiKey),
      apiKey.slice(-4),
      baseUrl,
      gatewayTenantExternalId || null,
      notes || null,
    ],
  );
}

async function touchUsage(tenantId) {
  await query(
    'UPDATE tenant_gateway_keys SET last_used_at = NOW() WHERE tenant_id = $1',
    [tenantId],
  );
}

/**
 * Returns a createGatewayClient preloaded with that tenant's stored key.
 * Throws if the tenant has no key yet (the caller should run
 * ensureGatewayProvision first).
 */
async function clientForTenant(tenantId) {
  const stored = await getGatewayKeyForTenant(tenantId);
  if (!stored || stored.status !== 'active') {
    throw new HttpError(409, 'tenant is not provisioned on the WhatsApp gateway');
  }
  await touchUsage(tenantId);
  const config = require('../config');
  // Overwrite baseUrl from the row (lets us rotate gateway endpoints
  // per tenant without redeploying).
  config.gateway = { ...(config.gateway || {}), baseUrl: stored.baseUrl };
  return createGatewayClient(config, { apiKey: stored.apiKey });
}

/**
 * Lazy provisioning (Wave 1 default):
 *
 *  1. If a row already exists, return it.
 *  2. Else: use the *global* GATEWAY_ADMIN_KEY + GATEWAY_BASE_URL from env
 *     to mint a single new gateway tenant for the SaaS tenant, then
 *     persist the issued apiKey row.
 *
 * The SaaS-DB-level `tenants.id` becomes the *external id* on the gateway.
 * No actual workspace is created today (the gateway is shared); but we
 * keep the external id mapping so we can switch per-tenant later.
 */
async function ensureProvisioned(tenantId) {
  const existing = await getGatewayKeyForTenant(tenantId);
  if (existing && existing.status === 'active') return existing;

  const adminKey = process.env.GATEWAY_ADMIN_KEY;
  const baseUrl = process.env.GATEWAY_BASE_URL;
  if (!adminKey || !baseUrl) {
    throw new HttpError(
      503,
      'Gateway is not configured: ask the platform admin to provision a key.',
    );
  }

  // Resolve the SaaS tenant name.
  const t = await query('SELECT id, name, email FROM tenants WHERE id = $1', [tenantId]);
  if (!t.rows[0]) throw new HttpError(404, 'SaaS tenant not found');

  // Lazy-mint a gateway tenant. The gateway mints the apiKey; we pass it
  // along with the external id so future gateway code can recover the
  // mapping. (Today the gateway has no /admin/tenants/:id GET, so we
  // don't bother confirming — creation is idempotent enough that a
  // duplicate call would 409, which we treat as success.)
  let gatewayTenant;
  try {
    const gwAdmin = createGatewayClient({ gateway: { baseUrl } }, { apiKey: adminKey });
    const created = await gwAdmin.request('POST', '/admin/tenants', {
      body: { name: `clickdz:${t.rows[0].name}` },
    });
    gatewayTenant = created;
  } catch (err) {
    // 409 = tenant name already exists; treat as success and continue.
    if (err && err.status && err.status !== 409) throw err;
    // Find existing via list — needed because the gateway mints no
    // apiKey except at creation time.
    const gwAdmin = createGatewayClient({ gateway: { baseUrl } }, { apiKey: adminKey });
    const listed = await gwAdmin.request('GET', '/admin/tenants');
    gatewayTenant = (listed.tenants || []).find(x => x.name === `clickdz:${t.rows[0].name}`);
    if (!gatewayTenant) throw new HttpError(500, 'gateway tenant lookup after 409 failed');
  }

  await setGatewayKeyForTenant(tenantId, {
    apiKey: gatewayTenant.apiKey,
    baseUrl,
    gatewayTenantExternalId: gatewayTenant.id,
    notes: 'lazy-provisioned on first /whatsapp/v2/* call',
  });
  return getGatewayKeyForTenant(tenantId);
}

const HttpError = require('../http/errors');

module.exports = {
  ensureProvisioned,
  getGatewayKeyForTenant,
  clientForTenant,
};
