require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://clickdz:clickdz_password@localhost:5432/clickdz_whatsapp',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash-lite',
    maxTokensPerReply: 300,
  },

  billing: {
    trialBudget: parseFloat(process.env.TRIAL_BUDGET || '5.00'),
    weeklyPrice: parseFloat(process.env.WEEKLY_PRICE || '7.00'),
    slickpayApiKey: process.env.SLICKPAY_API_KEY,
    slickpaySecret: process.env.SLICKPAY_SECRET,
  },

  whatsapp: {
    maxBridgesPerServer: parseInt(process.env.MAX_BRIDGES_PER_SERVER || '50'),
    bridgeRamMb: parseInt(process.env.BRIDGE_RAM_MB || '100'),
    replyRateLimitMs: 30000, // 1 reply per 30s per conversation
    importMessageLimit: 20,  // last 20 messages per conversation
    importConversationLimit: 100, // max 100 conversations on first sync
  },

  // Wave 0 — gateway proxy. Set USE_RAILWAY_GATEWAY=true on Vercel after
  // we provision the per-tenant API keys; until then the SaaS falls back
  // to the legacy in-process bridge and the QR loop symptoms continue.
  gateway: {
    enabled: String(process.env.USE_RAILWAY_GATEWAY || '').toLowerCase() === 'true',
    baseUrl: process.env.GATEWAY_BASE_URL || '',
    defaultApiKey: process.env.GATEWAY_API_KEY || '',
    adminApiKey: process.env.GATEWAY_ADMIN_KEY || '',
    requestTimeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS || '10000'),
  },
};
