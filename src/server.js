const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const config = require('./config');
const logger = require('./config/logger');
const bridgeManager = require('./services/whatsapp/manager');
const { processIncomingMessage } = require('./services/messageProcessor');
const whatsappEvents = require('./routes/whatsapp-events');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const whatsappRoutes = require('./routes/whatsapp');
const contactRoutes = require('./routes/contacts');
const knowledgeBaseRoutes = require('./routes/knowledgeBase');
const templateRoutes = require('./routes/templates');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const billingRoutes = require('./routes/billing');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Wave 1: WebSocket events proxy for the React dashboard (/ws/whatsapp).
// The existing /ws route below is unchanged (legacy dashboard live wire).
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) {
    try { ws.close(1008, 'Token required'); } catch { /* ignore */ }
    return;
  }
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, config.jwtSecret);
    const tenantId = payload.tenantId;
    wsClientsMapSetup(tenantId);
    wsClients.compute.get(tenantId).add(ws);
    ws.send(JSON.stringify({ type: 'connected', tenantId }));
    ws.on('close', () => {
      const clients = wsClients.compute.get(tenantId);
      if (clients) clients.delete(ws);
    });
  } catch (err) {
    try { ws.close(1008, 'Invalid token'); } catch { /* ignore */ }
  }
});
// (Wave 1 keeps the existing /ws path for backward compatibility but adds
// /ws/whatsapp as a separate proxy via `whatsappEvents.attach(server)` below.)

const wsClientsMap = new Map(); // legacy: /ws dashboard broadcast
const wsClients = { compute: wsClientsMap };
function wsClientsMapSetup(id) {
  if (!wsClientsMap.has(id)) wsClientsMap.set(id, new Set());
}

app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);

if (config.nodeEnv === 'production') {
  const frontendDist = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.get('/api/health', (req, res) => {
  const stats = bridgeManager.getStats();
  res.json({ status: 'ok', uptime: process.uptime(), bridges: stats, timestamp: new Date().toISOString() });
});

app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
});

server.listen(config.port, async () => {
  logger.info(`ClickDz WhatsApp server running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);

  try { await bridgeManager.restoreActiveBridges(); }
  catch (err) { logger.error('Failed to restore bridges on startup:', err); }

  // Wire the Wave 1 WS proxy (`/ws/whatsapp`) AFTER the HTTP server is up.
  whatsappEvents.attach(server);
  logger.info('Wave 1 WhatsApp event stream attached at /ws/whatsapp');
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await bridgeManager.stopAll();
  server.close(() => process.exit(0));
});
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await bridgeManager.stopAll();
  server.close(() => process.exit(0));
});

module.exports = { app, server };
