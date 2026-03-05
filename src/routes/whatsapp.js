const express = require('express');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');
const bridgeManager = require('../services/whatsapp/manager');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// POST /api/whatsapp/connect — start bridge and get QR
router.post('/connect', async (req, res, next) => {
  try {
    let bridge;
    try {
      bridge = await bridgeManager.startBridge(req.tenant.id);
    } catch (bridgeErr) {
      // Bridge may fail to connect (network issues, etc.) but we can still check for QR
      bridge = bridgeManager.getBridge(req.tenant.id);
      if (!bridge) {
        return res.status(503).json({ status: 'error', message: 'Failed to start WhatsApp bridge. Please try again.' });
      }
    }

    const status = bridge.getStatus();

    if (status === 'connected') {
      return res.json({ status: 'connected', message: 'WhatsApp already connected' });
    }

    // Wait briefly for QR code
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
  } catch (err) {
    next(err);
  }
});

// GET /api/whatsapp/status — get bridge status
router.get('/status', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (!bridge) {
      return res.json({ status: 'disconnected' });
    }
    res.json({ status: bridge.getStatus() });
  } catch (err) {
    next(err);
  }
});

// GET /api/whatsapp/qr — get current QR code
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
  } catch (err) {
    next(err);
  }
});

// POST /api/whatsapp/disconnect — disconnect bridge
router.post('/disconnect', async (req, res, next) => {
  try {
    await bridgeManager.stopBridge(req.tenant.id);
    await query(
      'UPDATE tenants SET whatsapp_connected = false WHERE id = $1',
      [req.tenant.id]
    );
    res.json({ status: 'disconnected' });
  } catch (err) {
    next(err);
  }
});

// POST /api/whatsapp/logout — logout and clear session
router.post('/logout', async (req, res, next) => {
  try {
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (bridge) {
      await bridge.logout();
    }
    await query(
      'UPDATE tenants SET whatsapp_connected = false, whatsapp_jid = NULL WHERE id = $1',
      [req.tenant.id]
    );
    res.json({ status: 'logged_out' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
