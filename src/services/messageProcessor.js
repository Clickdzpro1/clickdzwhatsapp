const { query, getClient } = require('../config/database');
const aiEngine = require('./ai/engine');
const bridgeManager = require('./whatsapp/manager');
const config = require('../config');
const logger = require('../config/logger');

// Rate limiting: track last reply time per conversation
const lastReplyTimes = new Map();

async function processIncomingMessage(data) {
  const { tenantId, messageId, senderJid, isFromMe, content, pushName } = data;

  try {
    // If message is from us (tenant), skip AI processing
    if (isFromMe) {
      await saveMessage(tenantId, senderJid, messageId, content, 'human', pushName);
      return;
    }

    // Get or create contact
    const contact = await getOrCreateContact(tenantId, senderJid, pushName);

    // Get or create conversation
    const conversation = await getOrCreateConversation(tenantId, contact.id, senderJid);

    // Save incoming message
    await saveMessage(tenantId, senderJid, messageId, content, 'client', pushName, conversation.id);

    // Update conversation
    await query(
      `UPDATE conversations SET last_message_preview = $1, last_message_at = NOW(),
       unread_count = unread_count + 1, updated_at = NOW() WHERE id = $2`,
      [content.substring(0, 200), conversation.id]
    );

    // Update contact last message time
    await query(
      'UPDATE contacts SET last_message_at = NOW() WHERE id = $1',
      [contact.id]
    );

    // Track daily usage
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO usage_daily (tenant_id, date, messages_received)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, date)
       DO UPDATE SET messages_received = usage_daily.messages_received + 1`,
      [tenantId, today]
    );

    // Update tenant message count
    await query(
      'UPDATE tenants SET messages_processed = messages_processed + 1 WHERE id = $1',
      [tenantId]
    );

    // AI categorization
    const analysis = await aiEngine.categorize(content);

    // Update conversation with analysis
    await query(
      `UPDATE conversations SET category = $1, priority = $2, sentiment = $3, updated_at = NOW() WHERE id = $4`,
      [analysis.category, analysis.priority, analysis.sentiment, conversation.id]
    );

    // Check if human takeover is active
    if (conversation.human_takeover) {
      logger.debug(`Human takeover active for conversation ${conversation.id}, skipping AI reply`);
      return;
    }

    // Check if AI is enabled for this conversation
    if (!conversation.ai_enabled) {
      return;
    }

    // Rate limit: max 1 AI reply per 30s per conversation
    const lastReply = lastReplyTimes.get(conversation.id);
    if (lastReply && Date.now() - lastReply < config.whatsapp.replyRateLimitMs) {
      logger.debug(`Rate limited AI reply for conversation ${conversation.id}`);
      return;
    }

    // Auto-escalate urgent/frustrated messages
    if (analysis.priority === 'urgent' || analysis.sentiment === 'frustrated') {
      await query(
        `UPDATE conversations SET status = 'escalated' WHERE id = $1`,
        [conversation.id]
      );

      // Log escalation
      await query(
        `INSERT INTO activity_log (tenant_id, action, actor_type, details, conversation_id)
         VALUES ($1, 'auto_escalated', 'system', $2, $3)`,
        [tenantId, JSON.stringify({ reason: analysis.priority === 'urgent' ? 'urgent_priority' : 'frustrated_sentiment' }), conversation.id]
      );
    }

    // Build context for AI reply
    const knowledgeBase = await query(
      'SELECT title, content FROM knowledge_base WHERE tenant_id = $1 AND is_active = true',
      [tenantId]
    );

    const serviceStatus = await query(
      "SELECT service_name, status, message FROM service_status WHERE tenant_id = $1 AND status != 'operational'",
      [tenantId]
    );

    // Get recent conversation history (last 10 messages for context)
    const history = await query(
      `SELECT content, sender_type FROM messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [conversation.id]
    );

    const replyResult = await aiEngine.generateReply(tenantId, {
      senderName: pushName || contact.name || 'Client',
      messageContent: content,
      conversationHistory: history.rows.reverse(),
      knowledgeBase: knowledgeBase.rows,
      serviceStatus: serviceStatus.rows,
      language: analysis.language,
    });

    if (replyResult.reply) {
      // Send via WhatsApp
      const bridge = bridgeManager.getBridge(tenantId);
      if (bridge && bridge.getStatus() === 'connected') {
        await bridge.sendMessage(senderJid, replyResult.reply);

        // Save AI reply
        await saveMessage(tenantId, senderJid, null, replyResult.reply, 'ai', null, conversation.id, replyResult.tokensUsed);

        // Update last reply time
        lastReplyTimes.set(conversation.id, Date.now());

        // Update conversation preview
        await query(
          `UPDATE conversations SET last_message_preview = $1, last_message_at = NOW() WHERE id = $2`,
          [`[AI] ${replyResult.reply.substring(0, 180)}`, conversation.id]
        );

        // Log activity
        await query(
          `INSERT INTO activity_log (tenant_id, action, actor_type, details, conversation_id)
           VALUES ($1, 'ai_reply', 'ai', $2, $3)`,
          [tenantId, JSON.stringify({ tokensUsed: replyResult.tokensUsed }), conversation.id]
        );
      }
    } else if (replyResult.reason === 'budget_exceeded') {
      logger.warn(`Budget exceeded for tenant ${tenantId}, AI replies paused`);
    }

  } catch (err) {
    logger.error(`Message processing error for tenant ${tenantId}:`, err);
  }
}

async function getOrCreateContact(tenantId, jid, pushName) {
  const existing = await query(
    'SELECT * FROM contacts WHERE tenant_id = $1 AND whatsapp_jid = $2',
    [tenantId, jid]
  );

  if (existing.rows.length > 0) {
    // Update push name if changed
    if (pushName && pushName !== existing.rows[0].push_name) {
      await query(
        'UPDATE contacts SET push_name = $1 WHERE id = $2',
        [pushName, existing.rows[0].id]
      );
    }
    return existing.rows[0];
  }

  const result = await query(
    `INSERT INTO contacts (tenant_id, whatsapp_jid, push_name, name, client_type)
     VALUES ($1, $2, $3, $4, 'new') RETURNING *`,
    [tenantId, jid, pushName, pushName]
  );

  return result.rows[0];
}

async function getOrCreateConversation(tenantId, contactId, jid) {
  // Look for open conversation with this contact
  const existing = await query(
    `SELECT * FROM conversations
     WHERE tenant_id = $1 AND contact_id = $2 AND status IN ('open', 'waiting', 'escalated')
     ORDER BY updated_at DESC LIMIT 1`,
    [tenantId, contactId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Check if this is a returning client
  const prevConvs = await query(
    'SELECT COUNT(*) as count FROM conversations WHERE tenant_id = $1 AND contact_id = $2',
    [tenantId, contactId]
  );

  if (parseInt(prevConvs.rows[0].count) > 0) {
    await query(
      "UPDATE contacts SET client_type = 'returning' WHERE id = $1",
      [contactId]
    );
  }

  const result = await query(
    `INSERT INTO conversations (tenant_id, contact_id, whatsapp_jid)
     VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, contactId, jid]
  );

  return result.rows[0];
}

async function saveMessage(tenantId, jid, waMessageId, content, senderType, pushName, conversationId, tokensUsed = 0) {
  if (!conversationId) {
    // Find conversation
    const conv = await query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND whatsapp_jid = $2 AND status IN ('open', 'waiting', 'escalated')
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, jid]
    );
    conversationId = conv.rows[0]?.id;
    if (!conversationId) return;
  }

  await query(
    `INSERT INTO messages (tenant_id, conversation_id, whatsapp_msg_id, sender_jid, sender_type, content, ai_tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [tenantId, conversationId, waMessageId, jid, senderType, content, tokensUsed]
  );
}

module.exports = { processIncomingMessage };
