/**
 * gatewayClient.js — thin fetch wrapper around Clickdzpro1/whatsapp-gateway
 * (Railway). Used by the SaaS to delegate ALL WhatsApp connection state to
 * the gateway: QR, pair-by-code, send, webhook delivery, message storage.
 *
 * Why this exists
 * ───────────────
 * The legacy bridge.js runs Baileys *inside* this Vercel-hosted process and
 * stores creds on the local filesystem — which is ephemeral on Vercel,
 * dies every cold start, and silently drops group messages. The Railway
 * gateway already implements: multi-tenant isolation, per-instance
 * ban-guard queue, LID → phone resolution, chat history hydration, pair-by
 * code (R15), and webhook fan-out. We let it own WhatsApp state and just
 * proxy REST calls + sign our webhook receivers.
 *
 * Usage
 * ─────
 *   const { createGatewayClient } = require('./services/gatewayClient');
 *   const gw = createGatewayClient({ ... });
 *   const qr = await gw.getInstanceQr(tenantId);
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Absolute base URL of the Railway gateway. Defaults to the staging host
 * from our deployment notes; override with GATEWAY_BASE_URL.
 */
function resolveBaseUrl(config) {
  const fromEnv = process.env.GATEWAY_BASE_URL;
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv.replace(/\/+$/, '');
  if (config && config.gateway && config.gateway.baseUrl) {
    return String(config.gateway.baseUrl).replace(/\/+$/, '');
  }
  throw new Error(
    'GATEWAY_BASE_URL is not set. Set it to e.g. https://wweb-gateway.up.railway.app',
  );
}

/**
 * Resolve a per-tenant API key. Two source paths are supported:
 *
 *   1. explicit `apiKey` argument (used when admin SDK calls happen
 *      on behalf of a specific tenant)
 *   2. ENV override (GATEWAY_API_KEY_<TENANT_ID> or GATEWAY_API_KEY)
 *
 * For now we accept a single global key from env. Per-tenant rotation
 * is added in Wave 1 (tenant_gateway_keys table).
 */
function resolveApiKey(opts) {
  if (opts && opts.apiKey) return opts.apiKey;
  const env = process.env.GATEWAY_API_KEY;
  if (env) return env;
  throw new Error(
    'GATEWAY_API_KEY is not set. Add a per-tenant API key to the gateway admin SDK.',
  );
}

function createGatewayClient(config) {
  const baseUrl = resolveBaseUrl(config);

  /**
   * Low-level request: JSON in, JSON out, timeout, structured errors.
   * Mirrors the error shape surfaced by whatsapp-gateway/src/routes so the
   * SaaS routes can forward the message + status unchanged.
   */
  async function request(method, path, { apiKey, body, query, timeoutMs } = {}) {
    const key = resolveApiKey({ apiKey });
    const qs = query && Object.keys(query).length
      ? '?' + new URLSearchParams(query).toString()
      : '';
    const url = baseUrl + path + qs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'clickdz-saas/1.0 (+gateway-proxy)',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err && err.name === 'AbortError'
        ? `Gateway timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
        : (err && err.message) || 'Gateway request failed';
      const e = new Error(`gateway ${method} ${path} failed: ${msg}`);
      e.code = 'GATEWAY_NETWORK';
      e.cause = err;
      throw e;
    }
    clearTimeout(timer);

    const text = await response.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; }
    catch {
      const e = new Error(
        `Gateway responded with non-JSON (status ${response.status}) on ${method} ${path}`,
      );
      e.code = 'GATEWAY_NONJSON';
      e.status = response.status;
      throw e;
    }

    if (!response.ok) {
      const err = new Error(
        (parsed && parsed.error) || `Gateway error ${response.status} on ${method} ${path}`,
      );
      err.status = response.status;
      err.code = (parsed && parsed.code) || 'GATEWAY_HTTP';
      err.details = parsed && parsed.details;
      throw err;
    }

    return parsed;
  }

  // ───── Tenant routes (per-tenant API key) ──────────────────────────
  return {
    baseUrl,
    /** Probe — used by healthcheck and onboarding smoke tests. */
    health() {
      return request('GET', '/health');
    },

    // ----- Instances -----
    async getInstanceQr(tenantApiKey, instanceId) {
      return request('GET', `/instances/${encodeURIComponent(instanceId)}/qr`, {
        apiKey: tenantApiKey,
      });
    },
    async getInstanceQrPng(tenantApiKey, instanceId) {
      // Returns a Buffer; caller decides where to serve from. We only use
      // this internally if the React app stops accepting data URLs.
      const key = resolveApiKey({ apiKey: tenantApiKey });
      const url = baseUrl + `/instances/${encodeURIComponent(instanceId)}/qr.png`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) throw new Error(`qr.png fetch failed: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async connectInstance(tenantApiKey, instanceId) {
      return request('POST', `/instances/${encodeURIComponent(instanceId)}/connect`, {
        apiKey: tenantApiKey,
      });
    },
    async pairInstance(tenantApiKey, instanceId, phoneNumber) {
      return request('POST', `/instances/${encodeURIComponent(instanceId)}/pair`, {
        apiKey: tenantApiKey,
        body: { phoneNumber },
      });
    },
    async disconnectInstance(tenantApiKey, instanceId) {
      return request('POST', `/instances/${encodeURIComponent(instanceId)}/disconnect`, {
        apiKey: tenantApiKey,
      });
    },
    async logoutInstance(tenantApiKey, instanceId) {
      return request('POST', `/instances/${encodeURIComponent(instanceId)}/logout`, {
        apiKey: tenantApiKey,
      });
    },
    async getInstance(tenantApiKey, instanceId) {
      return request('GET', `/instances/${encodeURIComponent(instanceId)}`, {
        apiKey: tenantApiKey,
      });
    },
    async listInstances(tenantApiKey) {
      return request('GET', '/instances', { apiKey: tenantApiKey });
    },
    async getInstanceStatus(tenantApiKey, instanceId) {
      // Falls back gracefully: status field comes back inside the instance object.
      const inst = await this.getInstance(tenantApiKey, instanceId);
      return { status: inst.status, connected: inst.status === 'connected' };
    },

    // ----- Send (used by messageProcessor / AI reply paths) -----
    async sendMessage(tenantApiKey, instanceId, jid, content) {
      // We use the simple POST shape the gateway exposes; detailed media
      // types are added in Wave 2 once we've routed media uploads.
      return request(
        'POST',
        `/instances/${encodeURIComponent(instanceId)}/messages/text`,
        { apiKey: tenantApiKey, body: { to: jid, text: content.text || content.caption || '' } },
      );
    },

    /**
     * Webhook signature verification. Gateway signs every OUT webhook with
     * the webhook_secret assigned at instance creation. Callers should call
     * this in any Express route that accepts inbound webhooks from the
     * gateway.
     *
     * Header: X-Gateway-Signature: sha256=<hex>
     * Body: raw request body (utf-8 string OR Buffer).
     */
    verifyWebhookSignature(secret, signatureHeader, rawBody) {
      const crypto = require('crypto');
      if (!secret) throw new Error('webhook secret missing — cannot verify signature');
      if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
      const provided = signatureHeader.slice('sha256='.length);
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      const a = Buffer.from(provided, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length !== b.length) return false;
      return require('crypto').timingSafeEqual(a, b);
    },
  };
}

module.exports = { createGatewayClient };
