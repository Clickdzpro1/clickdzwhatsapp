const express = require('express');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');
const aiEngine = require('../services/ai/engine');
const bridgeManager = require('../services/whatsapp/manager');

const router = express.Router();
router.use(authenticate, checkTenantActive);

// GET /api/conversations — list conversations
router.get('/', async (req, res, next) => {
  try {
    const { status, category, priority, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let where = 'c.tenant_id = $1';
    const params = [req.tenant.id];
    let paramIdx = 2;

    if (status) {
      where += ` AND c.status = $${paramIdx++}`;
      params.push(status);
    }
    if (category) {
      where += ` AND c.category = $${paramIdx++}`;
      params.push(category);
    }
    if (priority) {
      where += ` AND c.priority = $${paramIdx++}`;
      params.push(priority);
    }
    if (search) {
      where += ` AND (co.name ILIKE $${paramIdx} OR co.push_name ILIKE $${paramIdx} OR c.last_message_preview ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const result = await query(
      `SELECT c.*, co.name as contact_name, co.push_name, co.client_type, co.phone as contact_phone
       FROM conversations c
       JOIN contacts co ON c.contact_id = co.id
       WHERE ${where}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM conversations c JOIN contacts co ON c.contact_id = co.id WHERE ${where}`,
      params
    );

    res.json({
      conversations: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id — get conversation detail
router.get('/:id', async (req, res, next) => {
  try {
    const conv = await query(
      `SELECT c.*, co.name as contact_name, co.push_name, co.client_type, co.phone as contact_phone,
              co.tags as contact_tags, co.notes as contact_notes, co.metadata as contact_metadata
       FROM conversations c
       JOIN contacts co ON c.contact_id = co.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.tenant.id]
    );

    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conv.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id/messages — get messages
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const messages = await query(
      `SELECT * FROM messages
       WHERE conversation_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.tenant.id, parseInt(limit), parseInt(offset)]
    );

    // Mark as read
    await query(
      'UPDATE conversations SET unread_count = 0 WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );

    res.json({ messages: messages.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/reply — human reply
router.post('/:id/reply', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );
    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = conv.rows[0];

    // Send via WhatsApp
    const bridge = bridgeManager.getBridge(req.tenant.id);
    if (!bridge || bridge.getStatus() !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    await bridge.sendMessage(conversation.whatsapp_jid, content);

    // Save message
    const msg = await query(
      `INSERT INTO messages (tenant_id, conversation_id, sender_jid, sender_type, content)
       VALUES ($1, $2, $3, 'human', $4) RETURNING *`,
      [req.tenant.id, req.params.id, conversation.whatsapp_jid, content]
    );

    // Auto-enable human takeover
    await query(
      `UPDATE conversations SET human_takeover = true, human_takeover_at = NOW(),
       last_message_preview = $1, last_message_at = NOW() WHERE id = $2`,
      [content.substring(0, 200), req.params.id]
    );

    // Log activity
    await query(
      `INSERT INTO activity_log (tenant_id, action, actor_type, details, conversation_id)
       VALUES ($1, 'human_reply', 'human', '{}', $2)`,
      [req.tenant.id, req.params.id]
    );

    res.json(msg.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/conversations/:id — update conversation
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, category, priority, aiEnabled, humanTakeover, tags } = req.body;

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (status !== undefined) { updates.push(`status = $${paramIdx++}`); params.push(status); }
    if (category !== undefined) { updates.push(`category = $${paramIdx++}`); params.push(category); }
    if (priority !== undefined) { updates.push(`priority = $${paramIdx++}`); params.push(priority); }
    if (aiEnabled !== undefined) { updates.push(`ai_enabled = $${paramIdx++}`); params.push(aiEnabled); }
    if (humanTakeover !== undefined) {
      updates.push(`human_takeover = $${paramIdx++}`);
      params.push(humanTakeover);
      if (humanTakeover) {
        updates.push(`human_takeover_at = NOW()`);
      }
    }
    if (tags !== undefined) { updates.push(`tags = $${paramIdx++}`); params.push(tags); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id, req.tenant.id);
    const result = await query(
      `UPDATE conversations SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/handback — handback to AI
router.post('/:id/handback', async (req, res, next) => {
  try {
    await query(
      `UPDATE conversations SET human_takeover = false, ai_enabled = true WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.id]
    );

    await query(
      `INSERT INTO activity_log (tenant_id, action, actor_type, details, conversation_id)
       VALUES ($1, 'ai_handback', 'human', '{}', $2)`,
      [req.tenant.id, req.params.id]
    );

    res.json({ message: 'AI resumed for this conversation' });
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/summarize — generate context summary
router.post('/:id/summarize', async (req, res, next) => {
  try {
    const messages = await query(
      `SELECT content, sender_type FROM messages
       WHERE conversation_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 30`,
      [req.params.id, req.tenant.id]
    );

    const summary = await aiEngine.summarizeConversation(messages.rows.reverse());

    await query(
      'UPDATE conversations SET context_summary = $1 WHERE id = $2 AND tenant_id = $3',
      [summary, req.params.id, req.tenant.id]
    );

    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/notes — add internal note
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const result = await query(
      `INSERT INTO conversation_notes (tenant_id, conversation_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.tenant.id, req.params.id, content]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id/notes — list notes
router.get('/:id/notes', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM conversation_notes
       WHERE conversation_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.tenant.id]
    );
    res.json({ notes: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/bulk — bulk actions
router.post('/bulk', async (req, res, next) => {
  try {
    const { ids, action, value } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');

    switch (action) {
      case 'mark_read':
        await query(
          `UPDATE conversations SET unread_count = 0
           WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [req.tenant.id, ...ids]
        );
        break;
      case 'set_category':
        await query(
          `UPDATE conversations SET category = $${ids.length + 2}
           WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [req.tenant.id, ...ids, value]
        );
        break;
      case 'toggle_ai':
        await query(
          `UPDATE conversations SET ai_enabled = $${ids.length + 2}
           WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [req.tenant.id, ...ids, value]
        );
        break;
      case 'close':
        await query(
          `UPDATE conversations SET status = 'closed'
           WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [req.tenant.id, ...ids]
        );
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    res.json({ message: `${action} applied to ${ids.length} conversations` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
