const express = require('express');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');
const aiEngine = require('../services/ai/engine');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/dashboard/stats — overview stats
router.get('/stats', async (req, res, next) => {
  try {
    const tenantId = req.tenant.id;

    const [convStats, msgStats, contactStats, categoryStats] = await Promise.all([
      query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'escalated') as escalated,
          COUNT(*) FILTER (WHERE status = 'waiting') as waiting,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) FILTER (WHERE unread_count > 0) as unread
         FROM conversations WHERE tenant_id = $1`,
        [tenantId]
      ),
      query(
        `SELECT
          COUNT(*) FILTER (WHERE sender_type = 'client') as from_clients,
          COUNT(*) FILTER (WHERE sender_type = 'ai') as ai_replies,
          COUNT(*) FILTER (WHERE sender_type = 'human') as human_replies
         FROM messages WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [tenantId]
      ),
      query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE client_type = 'new') as new_clients,
          COUNT(*) FILTER (WHERE client_type = 'returning') as returning_clients
         FROM contacts WHERE tenant_id = $1`,
        [tenantId]
      ),
      query(
        `SELECT category, COUNT(*) as count
         FROM conversations WHERE tenant_id = $1 AND status != 'closed'
         GROUP BY category ORDER BY count DESC LIMIT 8`,
        [tenantId]
      ),
    ]);

    res.json({
      conversations: convStats.rows[0],
      messagesToday: msgStats.rows[0],
      contacts: contactStats.rows[0],
      categories: categoryStats.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/activity — activity log
router.get('/activity', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT al.*, c.whatsapp_jid
       FROM activity_log al
       LEFT JOIN conversations c ON al.conversation_id = c.id
       WHERE al.tenant_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.tenant.id, parseInt(limit), parseInt(offset)]
    );

    res.json({ activities: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/usage — usage stats
router.get('/usage', async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const result = await query(
      `SELECT * FROM usage_daily
       WHERE tenant_id = $1 AND date >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY date ASC`,
      [req.tenant.id, parseInt(days)]
    );
    res.json({ usage: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/digest — AI daily digest
router.get('/digest', async (req, res, next) => {
  try {
    const digest = await aiEngine.generateDigest(req.tenant.id);
    res.json(digest);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
