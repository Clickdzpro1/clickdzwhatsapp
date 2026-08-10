/**
 * routes/whatsapp.js — Wave 1 update.
 *
 *   - /v2/* no longer assumes singleton=tenant. Each request scopes to a
 *     specific `instanceId` (path param or body.id) and is gated by
 *     `requireInstanceAccess` ACL middleware.
 *   - Lazy provisioning: on first /v2/* call for a tenant without a stored
 *     gateway key, we mint one via the admin SDK.
 *   - The singleton legacy endpoint /v2/status returns the *first* allowed
 *     instance for the tenant (waves an instanceId-less UI through).
 *
 * Legacy /api/whatsapp/* endpoints still exist and still rely on the
 * in-process bridge — they are NOT wired to USE_RAILWAY_GATEWAY. That is
 * how Wave 1 ships the new path while leaving the old one byte-compatible.
 */

const express = require('express');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const {
  authenticate, checkTenantActive, requireInstanceAccess,
} = require('../middleware/auth');
const bridgeManager = require('../services/whatsapp/manager');
const { createGatewayClient } = require('../services/gatewayClient');
const {
  ensureProvisioned, clientForTenant, getGatewayKeyForTenant,
} = require('../services/tenantProvisioner');
const config = require('../config');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// ─── Shared helpers ────────────────────────────────────────────────────

/** Resolve the SaaS DB row for an instance. */
async function loadInstanceForTenant(tenantId, instanceId) {
  const r = await query(
    'SELECT * FROM whatsapp_instances WHERE tenant_id = $1 AND id = $2',
    [tenantId, instanceId],
  );
  return r.rows[0] || null;
}

/** Persist the gateway instance id + lifecycle status into the SaaS DB. */
async function upsertInstance(tenantId, opts) {
  await query(
    `INSERT INTO whatsapp_instances
       (id, tenant_id, owner_user_id, name, phone_number, engine, status,
        last_qr, last_qr_at, connected_at, warmup_until, webhook_url,
        webhook_secret, settings, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     ON CONFLICT (tenant_id, id) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, whatsapp_instances.name),
           phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_instances.phone_number),
           status = COALESCE(EXCLUDED.status, whatsapp_instances.status),
           last_qr = COALESCE(EXCLUDED.last_qr, whatsapp_instances.last_qr),
           last_qr_at = COALESCE(EXCLUDED.last_qr_at, whatsapp_instances.last_qr_at),
           connected_at = COALESCE(EXCLUDED.connected_at, whatsapp_instances.connected_at),
           warmup_until = COALESCE(EXCLUDED.warmup_until, whatsapp_instances.warmup_until),
           webhook_url = COALESCE(EXCLUDED.webhook_url, whatsapp_instances.webhook_url),
           webhook_secret = COALESCE(EXCLUDED.webhook_secret, whatsapp_instances.webhook_secret),
           settings = COALESCE(EXCLUDED.settings, whatsapp_instances.settings),
           updated_at = NOW()`,
    [
      opts.id,
      tenantId,
      opts.ownerUserId || null,
      opts.name || 'WhatsApp',
      opts.phoneNumber || null,
      opts.engine || 'wweb',
      opts.status || 'created',
      opts.lastQr || null,
      opts.lastQrAt || null,
      opts.connectedAt || null,
      opts.warmupUntil || null,
      opts.webhookUrl || null,
      opts.webhookSecret || null,
      JSON.stringify(opts.settings || {}),
      JSON.stringify(opts.metadata || {}),
    ],
  );
}

/** Mirror gateway → SaaS DB so the React widget can list "my WhatsApp accounts". */
function publicView(inst) {
  return {
    id: inst.id,
    name: inst.name,
    status: inst.status,
    phoneNumber: inst.phone_number,
    connectedAt: inst.connected_at,
    hasQr: !!inst.last_qr,
    warmupUntil: inst.warmup_until,
    settings: inst.settings || {},
    createdAt: inst.created_at,
    updatedAt: inst.updated_at,
  };
}

/**
 * For Wave 1 backwards-compat: a "current instance" pointer per tenant.
 * Stored on tenants.settings->'current_instance_id'. Lets the singleton-style
 * UI continue to work while we migrate pages.
 */
async function getCurrentInstanceId(tenantId) {
  const r = await query(
    `SELECT COALESCE((settings->>'current_instance_id'), NULL) AS cid
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return r.rows[0] && r.rows[0].cid;
}

/** Create a brand-new instance under the tenant's gateway tenant. */
router.post(
  '/v2/instances',
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      const name = (req.body && req.body.name) || `ClickDz-${Date.now()}`;
      // The gateway POST /instances returns the full instance object. We
      // mint an id matching convention (wai_<ulid>) for our DB; the gateway
      // will overwrite via the connect call (its id scheme is its own).
      const instanceId = `wai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // Trigger the gateway to actually open: POST /instances returns the row, but the gateway only commits when we call /connect.
      // (Safer alternative: call connectInstance which both creates + opens.)
      await upsertInstance(req.tenant.id, {
        id: instanceId,
        ownerUserId: req.user ? req.user.id : null,
        name,
        engine: 'wweb',
        status: 'created',
      });
      // The gateway expects the instance id from /instances list; we still
      // need to call /connect to actually produce a QR. The gateway will
      // return its own id but we keep the SaaS-side naming for UX.
      try {
        await gw.connectInstance(undefined, instanceId).catch(async (err) => {
          if (err.status === 404) {
            // The gateway is not tracking this id yet. Hit /instances first.
            await gw.request('POST', '/instances', {
              body: {
                id: instanceId,
                tenantId: undefined,
                name,
                settings: req.body && req.body.settings ? req.body.settings : {},
              },
            });
            return gw.connectInstance(undefined, instanceId);
          }
          throw err;
        });
      } catch (err) {
        // log + continue; the user sees status='connecting' and React polls.
        // eslint-disable-next-line no-console
        console.warn('[gateway] connect during create failed', err.status, err.message);
      }

      const row = await loadInstanceForTenant(req.tenant.id, instanceId);
      return res.status(201).json(publicView(row));
    } catch (err) { next(err); }
  },
);

// ─── List the tenant's instances ────────────────────────────────────
router.get(
  '/v2/instances',
  async (req, res, next) => {
    try {
      const r = await query(
        `SELECT wi.*, COALESCE(uacl.role, 'owner') AS user_role
           FROM whatsapp_instances wi
           LEFT JOIN whatsapp_instance_acl uacl
             ON uacl.instance_id = wi.id AND uacl.user_id = $2
          WHERE wi.tenant_id = $1
            AND (
              $2::uuid IS NULL
              OR wi.owner_user_id = $2
              OR uacl.user_id IS NOT NULL
            )
          ORDER BY wi.connected_at DESC NULLS LAST, wi.created_at DESC`,
        [req.tenant.id, req.user ? req.user.id : null],
      );
      const items = r.rows.map((row) => ({ ...publicView(row), role: row.user_role }));
      return res.json({ instances: items });
    } catch (err) { next(err); }
  },
);

// ─── Per-instance status / qr / connect / pair / disconnect / logout ─

router.get(
  '/v2/status',
  async (req, res, next) => {
    try {
      const cid = await getCurrentInstanceId(req.tenant.id);
      if (cid) {
        return router.handle({ ...req, url: `/v2/instances/${cid}/status`, params: { id: cid } }, res, next);
      }
      return res.json({ status: 'disconnected', connected: false });
    } catch (err) { next(err); }
  },
);

router.get(
  '/v2/instances/:id/status',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      try {
        const inst = await gw.getInstance(undefined, req.instance.id);
        await upsertInstance(req.tenant.id, {
          ...req.instance,
          status: inst.status,
          phoneNumber: inst.phoneNumber || req.instance.phone_number,
          connectedAt: inst.connectedAt || req.instance.connected_at,
        });
        return res.json({ status: inst.status, connected: inst.status === 'connected' });
      } catch (err) {
        if (err.status === 404) return res.json({ status: 'disconnected', connected: false });
        throw err;
      }
    } catch (err) { next(err); }
  },
);

router.get(
  '/v2/instances/:id/qr',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      try {
        const q = await gw.getInstanceQr(undefined, req.instance.id);
        if (q.qr) {
          let dataUrl;
          if (q.qr.startsWith('data:')) dataUrl = q.qr;
          else {
            dataUrl = await QRCode.toDataURL(q.qr);
          }
          return res.json({ status: q.status || 'qr_ready', qr: dataUrl });
        }
        return res.json({ status: q.status || 'connecting', qr: null });
      } catch (err) {
        if (err.status === 404) return res.status(202).json({ status: 'connecting', qr: null });
        throw err;
      }
    } catch (err) { next(err); }
  },
);

router.post(
  '/v2/instances/:id/connect',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      const data = await gw.connectInstance(undefined, req.instance.id);
      await upsertInstance(req.tenant.id, {
        ...req.instance,
        status: data.status || 'connecting',
      });
      // Remember as the user's "current" instance so the UI's first page
      // continues to work.
      await query(
        `UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb)
                          || jsonb_build_object('current_instance_id', $1::text)
            WHERE id = $2`,
        [req.instance.id, req.tenant.id],
      );
      return res.json({ id: req.instance.id, status: data.status });
    } catch (err) { next(err); }
  },
);

router.post(
  '/v2/instances/:id/pair',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      const phoneNumber = (req.body && req.body.phoneNumber) || '';
      if (!/^\d{8,15}$/.test(String(phoneNumber).replace(/[^\d]/g, ''))) {
        return res.status(400).json({ error: 'phoneNumber must be 8-15 digits including country code' });
      }
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      const r = await gw.pairInstance(undefined, req.instance.id, String(phoneNumber).replace(/[^\d]/g, ''));
      return res.json(r);
    } catch (err) { next(err); }
  },
);

router.post(
  '/v2/instances/:id/disconnect',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      try {
        await gw.disconnectInstance(undefined, req.instance.id);
        await upsertInstance(req.tenant.id, { ...req.instance, status: 'disconnected' });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      return res.json({ status: 'disconnected' });
    } catch (err) { next(err); }
  },
);

router.post(
  '/v2/instances/:id/logout',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      try { await gw.logoutInstance(undefined, req.instance.id); } catch (err) {
        if (!err.status || err.status !== 404) throw err;
      }
      await upsertInstance(req.tenant.id, { ...req.instance, status: 'logged_out' });
      return res.json({ status: 'logged_out' });
    } catch (err) { next(err); }
  },
);

router.delete(
  '/v2/instances/:id',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      await ensureProvisioned(req.tenant.id);
      const gw = await clientForTenant(req.tenant.id);
      try { await gw.request('DELETE', `/instances/${encodeURIComponent(req.instance.id)}`); } catch (err) {
        if (!err.status || err.status !== 404) throw err;
      }
      await query(
        'DELETE FROM whatsapp_instances WHERE tenant_id = $1 AND id = $2',
        [req.tenant.id, req.instance.id],
      );
      return res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ─── ACL: grant another user access to an instance ────────────────
router.post(
  '/v2/instances/:id/acl',
  requireInstanceAccess,
  async (req, res, next) => {
    try {
      // Only owners can grant ACL (requireInstanceAccess allowed us
      // through because we're the owner); re-check defensively.
      if (!req.user || req.user.id !== req.instance.owner_user_id) {
        return res.status(403).json({ error: 'only the instance owner can grant access' });
      }
      const targetUserEmail = (req.body && req.body.email) || '';
      const role = (req.body && req.body.role) || 'agent';
      if (!['admin', 'agent', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'role must be admin|agent|viewer' });
      }
      const u = await query(
        'SELECT id FROM users WHERE tenant_id = $1 AND email = $2',
        [req.tenant.id, targetUserEmail],
      );
      if (!u.rows[0]) return res.status(404).json({ error: 'user not found in this tenant' });
      await query(
        `INSERT INTO whatsapp_instance_acl (tenant_id, instance_id, user_id, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (instance_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [req.tenant.id, req.instance.id, u.rows[0].id, role],
      );
      return res.json({ ok: true, email: targetUserEmail, role });
    } catch (err) { next(err); }
  },
);

// Back-compat for the UI right now: if a caller hits the old pair-code
// path without an instanceId, we use the current instance pointer.
router.post(
  '/v2/pair-code',
  async (req, res, next) => {
    try {
      const cid = await getCurrentInstanceId(req.tenant.id);
      if (!cid) return res.status(409).json({ error: 'connect an instance first' });
      req.params.id = cid;
      // Re-enter via the per-instance middleware path.
      return router.handle({ ...req, url: `/v2/instances/${cid}/pair`, params: { id: cid }, method: 'POST' }, res, next);
    } catch (err) { next(err); }
  },
);

// ──────────────────────────────────────────────────────────────────────
// Legacy endpoints (UNCHANGED from Wave 0 — preserved for cut-over safety)
// ──────────────────────────────────────────────────────────────────────
router.post('/connect', async (req, res, next) => {
  try {
    let bridge;
    try { bridge = await bridgeManager.startBridge(req.tenant.id); }
    catch (bridgeErr) {
      bridge = bridgeManager.getBridge(req.tenant.id);
      if (!bridge) return res.status(503).json({ status: 'error', message: 'Failed to start WhatsApp bridge' });
    }
    const status = bridge.getStatus();
    if (status === 'connected') return res.json({ status: 'connected', message: 'WhatsApp already connected' });
    let qr = await bridge.getQR();
    if (!qr) { await new Promise(r => setTimeout(r, 3000)); qr = await bridge.getQR(); }
    if (qr) return res.json({ status: 'qr_ready', qr: await QRCode.toDataURL(qr) });
    res.json({ status: bridge.getStatus(), message: 'Connecting... retry shortly' });
  } catch (err) { next(err); }
});
const legacyConnect = router.stack[router.stack.length - 1].handle;

router.get('/status', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    res.json({ status: bridge ? bridge.getStatus() : 'disconnected' });
  } catch (err) { next(err); }
});
const legacyStatus = router.stack[router.stack.length - 1].handle;

router.get('/qr', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (!bridge) return res.status(404).json({ error: 'Bridge not started' });
    const qr = bridge.getQR();
    if (!qr) return res.json({ status: bridge.getStatus(), qr: null });
    res.json({ status: 'qr_ready', qr: await QRCode.toDataURL(qr) });
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
    if (bridge) await bridge.logout();
    await query('UPDATE tenants SET whatsapp_connected = false WHERE whatsapp_jid IS NULL AND id = $1', [req.tenant.id]);
    res.json({ status: 'logged_out' });
  } catch (err) { next(err); }
});
const legacyLogout = router.stack[router.stack.length - 1].handle;

module.exports = router;
