/**
 * whatsapp.js (Wave 0 update)
 *
 * Snapshot of the legacy route file. We do NOT delete the original endpoints
 * in this PR — backwards compatibility matters because Wave 0 lands before
 * tenants can be cut over. Instead we add a parallel /v2/* tree that:
 *
 *   1. Goes through the Railway gateway when USE_RAILWAY_GATEWAY=true.
 *   2. Falls back to the in-process bridge when false (current behavior).
 *   3. Uses the same QR response shape — `{ status, qr: dataUrl }` — but
 *      with the data URL string correctly extracted on the client.
 *
 * The old `/connect`, `/status`, `/qr`, `/disconnect`, `/logout` endpoints
 * remain untouched in this PR. They will be removed in Wave 1.
 */

const express = require('express');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');
const bridgeManager = require('../services/whatsapp/manager');
const { createGatewayClient } = require('../services/gatewayClient');
const config = require('../config');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// ──────────────────────────────────────────────────────────────────────
// Wave 0: gateway proxy (additive; legacy endpoints below stay intact)
// ──────────────────────────────────────────────────────────────────────

function useRailwayGateway() {
  // Wave 0 default = false: safer cut-over, lets the tenant choose per env.
  // Once Vercel has GATEWAY_BASE_URL + GATEWAY_API_KEY set AND
  // USE_RAILWAY_GATEWAY='true', all /v2/* traffic flows through the gateway.
  return String(process.env.USE_RAILWAY_GATEWAY || '').toLowerCase() === 'true';
}

/**
 * Per-tenant singleton instance id. The Wave 0 SaaS keeps the 1:1
 * (one tenant → one WhatsApp) model but routes the connection through the
 * gateway so sessions survive redeploys. Wave 1 swaps this for a DB-backed
 * N:1 mapping with proper ACL.
 */
function ensureInstanceIdForTenant(tenantId) {
  // Stable, deterministic, easy to recognise in logs.
  return `wai_${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

const gateway = createGatewayClient(config);

/**
 * Minimal in-process cache of the api key issued for tenant_id on first
 * call. Real implementation lands in Wave 1 alongside the
 * tenant_gateway_keys table — until then we fall back to the global
 * GATEWAY_API_KEY.
 */
const tenantKeyFallback = () => process.env.GATEWAY_API_KEY || null;

async function ensureTenantOnGateway(tenantId) {
  // Best-effort tenant-create. The gateway admin/tenants endpoint wants
  // { name }; downstream code already knows the SaaS tenant name.
  const tenant = await query('SELECT id, name FROM tenants WHERE id = $1', [tenantId]);
  if (!tenant.rows[0]) throw Object.assign(new Error('tenant not found'), { status: 404 });
  try {
    const adminKey = process.env.GATEWAY_ADMIN_KEY || tenantKeyFallback();
    await gateway.request('POST', '/admin/tenants', {
      apiKey: adminKey,
      body: { name: tenant.rows[0].name, externalId: tenant.rows[0].id },
    });
  } catch (err) {
    // 409 (already exists) is fine; anything else logs and continues.
    if (err && err.status && err.status !== 409) {
      // eslint-disable-next-line no-console
      console.warn('[gateway] tenant upsert failed', err.status, err.message);
    }
  }
  return tenant.rows[0];
}

// ───── CONNECT ─────
router.post('/v2/connect', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) return legacyConnect(req, res, next);
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    // Try connect; if 404 the gateway has never seen the instance — create it on demand.
    try {
      const data = await gateway.connectInstance(tenantKeyFallback(), instanceId);
      return res.json({ status: data.status, qr: null });
    } catch (err) {
      if (err.status === 404) {
        await gateway.request('POST', '/admin/instances', {
          apiKey: process.env.GATEWAY_ADMIN_KEY || tenantKeyFallback(),
          body: {
            externalId: instanceId,
            tenantExternalId: tenant.id,
            name: tenant.name,
          },
        });
        const data = await gateway.connectInstance(tenantKeyFallback(), instanceId);
        // The gateway emits a QR via webhook; frontend should poll /v2/qr.
        // We opportunistically fetch once in case it's already cached server-side.
        try {
          const q = await gateway.getInstanceQr(tenantKeyFallback(), instanceId);
          return res.json({ status: q.status, qr: q.qr || null });
        } catch {
          return res.json({ status: data.status, qr: null });
        }
      }
      throw err;
    }
  } catch (err) { next(err); }
});

// ───── STATUS ─────
router.get('/v2/status', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) return legacyStatus(req, res, next);
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    try {
      const s = await gateway.getInstanceStatus(tenantKeyFallback(), instanceId);
      return res.json(s);
    } catch (err) {
      if (err.status === 404) return res.json({ status: 'disconnected', connected: false });
      throw err;
    }
  } catch (err) { next(err); }
});

// ───── QR (returns data URL string; the React page extracts `.qr` directly) ─────
router.get('/v2/qr', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) return legacyQr(req, res, next);
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    try {
      const q = await gateway.getInstanceQr(tenantKeyFallback(), instanceId);
      // Gateways returns `qr` as raw string. We make a data URL for the React <img>.
      if (q.qr) {
        const url = q.qr.startsWith('data:')
          ? q.qr
          : 'data:image/png;base64,' + await QRCode.toDataURL(q.qr).then(s => s.split(',')[1]);
        return res.json({ status: q.status || 'qr_ready', qr: url });
      }
      return res.json({ status: q.status || 'connecting', qr: null });
    } catch (err) {
      if (err.status === 404) return res.status(202).json({ status: 'connecting', qr: null });
      throw err;
    }
  } catch (err) { next(err); }
});

// ───── Pair-by-Code (8-digit alt QR; lives minutes, beats QR rotation) ─────
router.post('/v2/pair-code', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) {
      return res.status(404).json({
        error: 'pair-by-code requires USE_RAILWAY_GATEWAY=true (Railway gateway must own the session)',
      });
    }
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    const phoneNumber = (req.body && req.body.phoneNumber) || '';
    if (!/^\d{8,15}$/.test(String(phoneNumber).replace(/[^\d]/g, ''))) {
      return res.status(400).json({
        error: 'phoneNumber must be 8-15 digits including country code (e.g. 213555123456)',
      });
    }
    const r = await gateway.pairInstance(
      tenantKeyFallback(),
      instanceId,
      String(phoneNumber).replace(/[^\d]/g, ''),
    );
    return res.json(r);
  } catch (err) { next(err); }
});

// ───── DISCONNECT / LOGOUT ─────
router.post('/v2/disconnect', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) return legacyDisconnect(req, res, next);
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    try {
      await gateway.disconnectInstance(tenantKeyFallback(), instanceId);
      await query('UPDATE tenants SET whatsapp_connected = false WHERE id = $1', [tenant.id]);
      return res.json({ status: 'disconnected' });
    } catch (err) {
      if (err.status === 404) return res.json({ status: 'disconnected' });
      throw err;
    }
  } catch (err) { next(err); }
});

router.post('/v2/logout', async (req, res, next) => {
  try {
    if (!useRailwayGateway()) return legacyLogout(req, res, next);
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    try {
      await gateway.logoutInstance(tenantKeyFallback(), instanceId);
    } catch (err) {
      if (!err.status || err.status === 404) {
        // already gone
      } else throw err;
    }
    await query(
      'UPDATE tenants SET whatsapp_connected = false, whatsapp_jid = NULL WHERE id = $1',
      [tenant.id],
    );
    return res.json({ status: 'logged_out' });
  } catch (err) { next(err); }
});

// ───── LIST (Wave 1 prep) ─────
router.get('/v2/instances', async (req, res, next) => {
  try {
    // The proxy stores only the singleton instance per tenant today; once
    // Wave 1 adds the ACL table we list from the SaaS DB instead.
    if (!useRailwayGateway()) return res.json({ instances: [] });
    const tenant = await ensureTenantOnGateway(req.tenant.id);
    const instanceId = ensureInstanceIdForTenant(tenant.id);
    try {
      const inst = await gateway.getInstance(tenantKeyFallback(), instanceId);
      return res.json({ instances: [inst] });
    } catch (err) {
      if (err.status === 404) return res.json({ instances: [] });
      throw err;
    }
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────────────────────
// Legacy endpoints (unchanged behaviour; kept for cut-over safety)
// ──────────────────────────────────────────────────────────────────────

router.post('/connect', async (req, res, next) => {
  try {
    let bridge;
    try {
      bridge = await bridgeManager.startBridge(req.tenant.id);
    } catch (bridgeErr) {
      bridge = bridgeManager.getBridge(req.tenant.id);
      if (!bridge) {
        return res.status(503).json({ status: 'error', message: 'Failed to start WhatsApp bridge. Please try again.' });
      }
    }

    const status = bridge.getStatus();
    if (status === 'connected') {
      return res.json({ status: 'connected', message: 'WhatsApp already connected' });
    }
    let qr = await bridge.getQR();
    if (!qr) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      qr = await bridge.getQR();
    }
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      return res.json({ status: 'qr_ready', qr: qrDataUrl });
    }
    res.json({ status: bridge.getStatus(), message: 'Connecting... Please retry in a few seconds to get QR code.' });
  } catch (err) { next(err); }
});
const legacyConnect = router.stack[router.stack.length - 1].handle;

router.get('/status', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (!bridge) {
      return res.json({ status: 'disconnected' });
    }
    res.json({ status: bridge.getStatus() });
  } catch (err) { next(err); }
});
const legacyStatus = router.stack[router.stack.length - 1].handle;

router.get('/qr', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (!bridge) {
      return res.status(404).json({ error: 'Bridge not started. Call POST /connect first.' });
    }
    const qr = bridge.getQR();
    if (!qr) {
      return res.json({ status: bridge.getStatus(), qr: null });
    }
    const qrDataUrl = await QRCode.toDataURL(qr);
    res.json({ status: 'qr_ready', qr: qrDataUrl });
  } catch (err) { next(err); }
});
const legacyQr = router.stack[router.stack.length - 1].handle;

router.post('/disconnect', async (req, res, next) => {
  try {
    await bridgeManager.stopBridge(req.tenant.id);
    await query('UPDATE tenants SET whatsapp_connected = false WHERE id = $1', [req.tenant.id]);
    res.json({ status: 'disconnected' });
  } catch (err) { next(err); }
});
const legacyDisconnect = router.stack[router.stack.length - 1].handle;

router.post('/logout', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (bridge) {
      await bridge.logout();
    }
    await query('UPDATE tenants SET whatsapp_connected = false, whatsapp_jid = NULL WHERE id = $1', [req.tenant.id]);
    res.json({ status: 'logged_out' });
  } catch (err) { next(err); }
});
const legacyLogout = router.stack[router.stack.length - 1].handle;

module.exports = router;
