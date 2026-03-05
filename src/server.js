const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http = require('http');

const config = require('./config');
const logger = require('./config/logger');
const bridgeManager = require('./services/whatsapp/manager');
const { processIncomingMessage } = require('./services/messageProcessor');

// Routes
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

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Routes
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

// Health check
app.get('/api/health', (req, res) => {
  const bridgeStats = bridgeManager.getStats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    bridges: bridgeStats,
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
});

// WebSocket connection handling
const wsClients = new Map(); // tenantId -> Set<ws>

wss.on('connection', (ws, req) => {
  // Auth via query param (token)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(1008, 'Token required');
    return;
  }

  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, config.jwtSecret);
    const tenantId = payload.tenantId;

    if (!wsClients.has(tenantId)) {
      wsClients.set(tenantId, new Set());
    }
    wsClients.get(tenantId).add(ws);

    ws.on('close', () => {
      const clients = wsClients.get(tenantId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) wsClients.delete(tenantId);
      }
    });

    ws.send(JSON.stringify({ type: 'connected', tenantId }));
  } catch (err) {
    ws.close(1008, 'Invalid token');
  }
});

// Broadcast to tenant's connected clients
function broadcastToTenant(tenantId, data) {
  const clients = wsClients.get(tenantId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Set up message handler for bridges
bridgeManager.setMessageHandler(async (data) => {
  await processIncomingMessage(data);

  // Broadcast to tenant's dashboard
  broadcastToTenant(data.tenantId, {
    type: 'new_message',
    senderJid: data.senderJid,
    content: data.content,
    isFromMe: data.isFromMe,
    timestamp: data.timestamp,
  });
});

// Start server
server.listen(config.port, async () => {
  logger.info(`ClickDz WhatsApp server running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);

  // Restore active bridges
  try {
    await bridgeManager.restoreActiveBridges();
  } catch (err) {
    logger.error('Failed to restore bridges on startup:', err);
  }
});

// Graceful shutdown
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
