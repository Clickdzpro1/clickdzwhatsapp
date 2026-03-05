const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const logger = require('../../config/logger');
const config = require('../../config');

class WhatsAppBridge {
  constructor(tenantId, eventHandler) {
    this.tenantId = tenantId;
    this.eventHandler = eventHandler;
    this.socket = null;
    this.qrCode = null;
    this.status = 'disconnected'; // disconnected, connecting, qr_ready, connected
    this.retryCount = 0;
    this.maxRetries = 5;
    this.sessionDir = path.join(process.cwd(), 'sessions', tenantId);
  }

  async connect() {
    if (this.status === 'connected' || this.status === 'connecting') return;

    this.status = 'connecting';
    logger.info(`WhatsApp bridge connecting for tenant ${this.tenantId}`);

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger: logger.child({ module: 'baileys' }),
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      // Handle connection updates
      this.socket.ev.on('connection.update', (update) => {
        this._handleConnectionUpdate(update);
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      this.socket.ev.on('messages.upsert', (msgUpdate) => {
        this._handleMessages(msgUpdate);
      });

      // Handle message status updates (read receipts, etc.)
      this.socket.ev.on('messages.update', (updates) => {
        this.eventHandler.emit('messages:status', { tenantId: this.tenantId, updates });
      });

      // Handle contacts update
      this.socket.ev.on('contacts.update', (contacts) => {
        this.eventHandler.emit('contacts:update', { tenantId: this.tenantId, contacts });
      });

    } catch (err) {
      logger.error(`WhatsApp bridge error for tenant ${this.tenantId}:`, err);
      this.status = 'disconnected';
      throw err;
    }
  }

  _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrCode = qr;
      this.status = 'qr_ready';
      this.eventHandler.emit('qr', { tenantId: this.tenantId, qr });
      logger.info(`QR code generated for tenant ${this.tenantId}`);
    }

    if (connection === 'open') {
      this.status = 'connected';
      this.retryCount = 0;
      this.qrCode = null;
      const jid = this.socket.user?.id;
      this.eventHandler.emit('connected', { tenantId: this.tenantId, jid });
      logger.info(`WhatsApp connected for tenant ${this.tenantId}, JID: ${jid}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      this.status = 'disconnected';
      logger.warn(`WhatsApp disconnected for tenant ${this.tenantId}, code: ${statusCode}`);

      if (shouldReconnect && this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        logger.info(`Reconnecting tenant ${this.tenantId} in ${delay}ms (attempt ${this.retryCount})`);
        setTimeout(() => this.connect(), delay);
      } else if (!shouldReconnect) {
        // User logged out, clean session
        this._cleanSession();
        this.eventHandler.emit('logged_out', { tenantId: this.tenantId });
      }
    }
  }

  _handleMessages(msgUpdate) {
    const { messages, type } = msgUpdate;

    // Only process new messages (not history sync for now during real-time)
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip status broadcasts and group messages
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;

      const isFromMe = msg.key.fromMe;
      const senderJid = msg.key.remoteJid;
      const content = this._extractContent(msg);

      if (!content) continue;

      this.eventHandler.emit('message', {
        tenantId: this.tenantId,
        messageId: msg.key.id,
        senderJid,
        isFromMe,
        content,
        timestamp: msg.messageTimestamp,
        pushName: msg.pushName,
        message: msg,
      });
    }
  }

  _extractContent(msg) {
    const m = msg.message;
    if (!m) return null;

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return `[Image] ${m.imageMessage.caption}`;
    if (m.imageMessage) return '[Image]';
    if (m.videoMessage?.caption) return `[Video] ${m.videoMessage.caption}`;
    if (m.videoMessage) return '[Video]';
    if (m.audioMessage) return '[Audio]';
    if (m.documentMessage) return `[Document] ${m.documentMessage.fileName || ''}`;
    if (m.stickerMessage) return '[Sticker]';
    if (m.contactMessage) return `[Contact] ${m.contactMessage.displayName || ''}`;
    if (m.locationMessage) return '[Location]';

    return null;
  }

  async sendMessage(jid, text) {
    if (this.status !== 'connected' || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    const result = await this.socket.sendMessage(jid, { text });
    return result;
  }

  async getQR() {
    return this.qrCode;
  }

  getStatus() {
    return this.status;
  }

  async disconnect() {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.status = 'disconnected';
    logger.info(`WhatsApp bridge disconnected for tenant ${this.tenantId}`);
  }

  async logout() {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    this._cleanSession();
    this.status = 'disconnected';
    logger.info(`WhatsApp bridge logged out for tenant ${this.tenantId}`);
  }

  _cleanSession() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true });
      }
    } catch (err) {
      logger.error(`Failed to clean session for tenant ${this.tenantId}:`, err);
    }
  }
}

module.exports = WhatsAppBridge;
