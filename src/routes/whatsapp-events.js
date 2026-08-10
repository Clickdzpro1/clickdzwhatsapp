/**
 * routes/whatsapp-events.js — server-side WS proxy from the SaaS browser
 * back to the Railway gateway. The browser opens `wss://<saas>/ws/whatsapp`
 * with the JWT in `?token=`, this file validates it, opens an outbound
 * WS to the gateway using the tenant's stored api key, and pipes events
 * both ways (proxy-direction is gateway → browser only, the SaaS never
 * speaks back to the gateway over WS).
 *
 * The SaaS stores every event into `whatsapp_events` for auditing /
 * reconnection catch-up. The last 200 events per tenant are replayed on
 * a fresh client connect (browsers handle missed messages via the WS
 * resume, but we keep this as belt-and-braces for mobile pause/resume).
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../config/database');
const { ensureProvisioned, clientForTenant } = require('../services/tenantProvisioner');

const PATH = '/ws/whatsapp';

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(PATH)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      try { ws.close(1008, 'token required'); } catch { /* ignore */ }
      return;
    }
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); }
    catch {
      try { ws.close(1008, 'invalid token'); } catch { /* ignore */ }
      return;
    }
    const tenantId = payload.tenantId;

    await ensureProvisioned(tenantId).catch((err) => {
      try { ws.send(JSON.stringify({ type: 'error', message: err.message })); ws.close(1011); } catch { /* ignore */ }
    });

    // Replay last 200 events from the local audit table.
    try {
      const replay = await query(
        `SELECT id, instance_id, event, payload, received_at
           FROM whatsapp_events
          WHERE tenant_id = $1
          ORDER BY id DESC
          LIMIT 200`,
        [tenantId],
      );
      for (const r of replay.rows.reverse()) {
        ws.send(JSON.stringify({
          type: 'replay',
          id: r.id,
          instance_id: r.instance_id,
          event: r.event,
          payload: r.payload,
          received_at: r.received_at,
        }));
      }
    } catch (err) {
      // ignore: continue without replay
    }

    // Open the upstream gateway WS using the tenant's stored api key.
    let upstream;
    try {
      const stored = await clientForTenant(tenantId);
      upstream = new (require('ws'))(
        stored.baseUrl.replace(/^http/, 'ws') + '/events',
        { headers: { Authorization: `Bearer ${stored.apiKey}` } },
      );
    } catch (err) {
      try { ws.send(JSON.stringify({ type: 'error', message: err.message })); ws.close(1011); } catch { /* ignore */ }
      return;
    }

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      try { upstream.close(); } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    };

    upstream.on('message', (raw) => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        ws.send(JSON.stringify(parsed));
        // Mirror into the local audit table so the next browser reconnect
        // gets a replay without depending on the gateway.
        query(
          `INSERT INTO whatsapp_events (tenant_id, instance_id, event, payload)
             VALUES ($1, $2, $3, $4)`,
          [tenantId, parsed.instance_id || null, parsed.event || parsed.type, parsed],
        ).catch(() => { /* swallow: do not crash on DB blips */ });
      } catch {
        try { ws.send(raw); } catch { /* ignore */ }
      }
    });
    upstream.on('error', cleanup);
    upstream.on('close', cleanup);
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}

module.exports = { attach, PATH };
