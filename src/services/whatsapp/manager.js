const EventEmitter = require('events');
const WhatsAppBridge = require('./bridge');
const { query } = require('../../config/database');
const logger = require('../../config/logger');

class BridgeManager {
  constructor() {
    this.bridges = new Map(); // tenantId -> WhatsAppBridge
    this.eventEmitter = new EventEmitter();
    this.messageHandler = null;
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  async startBridge(tenantId) {
    if (this.bridges.has(tenantId)) {
      const existing = this.bridges.get(tenantId);
      if (existing.getStatus() === 'connected') {
        return existing;
      }
    }

    const bridge = new WhatsAppBridge(tenantId, this.eventEmitter);

    // Handle events for this bridge
    this.eventEmitter.on('connected', async (data) => {
      if (data.tenantId !== tenantId) return;
      await query(
        'UPDATE tenants SET whatsapp_connected = true, whatsapp_jid = $1 WHERE id = $2',
        [data.jid, tenantId]
      );
    });

    this.eventEmitter.on('logged_out', async (data) => {
      if (data.tenantId !== tenantId) return;
      await query(
        'UPDATE tenants SET whatsapp_connected = false, whatsapp_jid = NULL WHERE id = $1',
        [tenantId]
      );
      this.bridges.delete(tenantId);
    });

    this.eventEmitter.on('message', async (data) => {
      if (data.tenantId !== tenantId) return;
      if (this.messageHandler) {
        await this.messageHandler(data);
      }
    });

    this.bridges.set(tenantId, bridge);
    await bridge.connect();
    return bridge;
  }

  getBridge(tenantId) {
    return this.bridges.get(tenantId);
  }

  async stopBridge(tenantId) {
    const bridge = this.bridges.get(tenantId);
    if (bridge) {
      await bridge.disconnect();
      this.bridges.delete(tenantId);
    }
  }

  async stopAll() {
    for (const [tenantId, bridge] of this.bridges) {
      await bridge.disconnect();
    }
    this.bridges.clear();
  }

  getStats() {
    const stats = {
      totalBridges: this.bridges.size,
      connected: 0,
      connecting: 0,
      disconnected: 0,
    };
    for (const bridge of this.bridges.values()) {
      const status = bridge.getStatus();
      if (status === 'connected') stats.connected++;
      else if (status === 'connecting' || status === 'qr_ready') stats.connecting++;
      else stats.disconnected++;
    }
    return stats;
  }

  // Restore bridges for all active tenants on server start
  async restoreActiveBridges() {
    try {
      const result = await query(
        "SELECT id FROM tenants WHERE whatsapp_connected = true AND status = 'active'"
      );
      logger.info(`Restoring ${result.rows.length} WhatsApp bridges...`);

      for (const row of result.rows) {
        try {
          await this.startBridge(row.id);
        } catch (err) {
          logger.error(`Failed to restore bridge for tenant ${row.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('Failed to restore bridges:', err);
    }
  }
}

// Singleton
const bridgeManager = new BridgeManager();
module.exports = bridgeManager;
