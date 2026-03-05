const config = require('../../config');
const { query } = require('../../config/database');
const logger = require('../../config/logger');

class AIEngine {
  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
    this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
  }

  async generateReply(tenantId, conversationContext) {
    const { senderName, messageContent, conversationHistory, knowledgeBase, serviceStatus, language } = conversationContext;

    // Check budget
    const budgetOk = await this._checkBudget(tenantId);
    if (!budgetOk) {
      return {
        reply: null,
        reason: 'budget_exceeded',
        tokensUsed: 0,
      };
    }

    const systemPrompt = this._buildSystemPrompt(knowledgeBase, serviceStatus, language);
    const messages = this._buildMessages(conversationHistory, messageContent, senderName);

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: messages,
          generationConfig: {
            maxOutputTokens: config.gemini.maxTokensPerReply,
            temperature: 0.7,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

      // Track usage
      await this._trackUsage(tenantId, tokensUsed);

      return { reply, tokensUsed, reason: 'success' };
    } catch (err) {
      logger.error(`AI reply failed for tenant ${tenantId}:`, err);
      return { reply: null, reason: 'error', tokensUsed: 0, error: err.message };
    }
  }

  async categorize(messageContent) {
    const prompt = `Analyze this WhatsApp message and return ONLY a JSON object (no markdown, no explanation):
{
  "category": one of ["pricing", "activation", "renewal", "support", "billing", "complaint", "greeting", "order", "info", "other"],
  "priority": one of ["urgent", "high", "normal", "low"],
  "sentiment": one of ["positive", "neutral", "negative", "frustrated"],
  "language": detected language code ("ar", "fr", "en", "dz" for Darija),
  "clientIntent": brief summary of what the client wants (max 10 words)
}

Message: "${messageContent}"`;

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 150, temperature: 0.1 },
        }),
      });

      if (!response.ok) throw new Error(`Gemini API error ${response.status}`);

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON from response (handle potential markdown wrapping)
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (err) {
      logger.error('AI categorization failed:', err);
      return {
        category: 'other',
        priority: 'normal',
        sentiment: 'neutral',
        language: 'ar',
        clientIntent: 'unknown',
      };
    }
  }

  async generateDigest(tenantId) {
    const today = new Date().toISOString().split('T')[0];
    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE sender_type = 'client') as client_messages,
        COUNT(*) FILTER (WHERE sender_type = 'ai') as ai_replies,
        COUNT(*) FILTER (WHERE sender_type = 'human') as human_replies
       FROM messages
       WHERE tenant_id = $1 AND created_at >= $2::date`,
      [tenantId, today]
    );

    const convStats = await query(
      `SELECT category, COUNT(*) as count
       FROM conversations
       WHERE tenant_id = $1 AND updated_at >= $2::date
       GROUP BY category ORDER BY count DESC LIMIT 5`,
      [tenantId, today]
    );

    const urgent = await query(
      `SELECT c.whatsapp_jid, co.name, c.last_message_preview
       FROM conversations c
       JOIN contacts co ON c.contact_id = co.id
       WHERE c.tenant_id = $1 AND c.priority IN ('urgent', 'high') AND c.status = 'open'
       LIMIT 5`,
      [tenantId]
    );

    return {
      date: today,
      messages: stats.rows[0],
      topCategories: convStats.rows,
      urgentConversations: urgent.rows,
    };
  }

  async summarizeConversation(messages) {
    const transcript = messages.map(m =>
      `${m.sender_type === 'client' ? 'Client' : 'Agent'}: ${m.content}`
    ).join('\n');

    const prompt = `Summarize this WhatsApp conversation in 2-3 sentences. Focus on: what the client wants, current status, and any pending actions.

${transcript}`;

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 150, temperature: 0.3 },
        }),
      });

      if (!response.ok) throw new Error(`Gemini API error ${response.status}`);

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      logger.error('Conversation summary failed:', err);
      return '';
    }
  }

  _buildSystemPrompt(knowledgeBase, serviceStatus, language) {
    let langInstructions;
    switch (language) {
      case 'dz':
        langInstructions = 'Reply in Algerian Darija (Arabic dialect). Use casual, friendly tone. You can mix some French words as is natural in Darija.';
        break;
      case 'ar':
        langInstructions = 'Reply in Modern Standard Arabic. Be professional but warm.';
        break;
      case 'fr':
        langInstructions = 'Répondez en français. Soyez professionnel mais chaleureux.';
        break;
      default:
        langInstructions = 'Reply in English. Be professional but friendly.';
    }

    let prompt = `You are a helpful WhatsApp business assistant. ${langInstructions}

Rules:
- Keep replies SHORT (1-3 sentences max). This is WhatsApp, not email.
- Be helpful, accurate, and natural.
- If you don't know something, say so honestly — don't make up information.
- Never share internal business details or competitor info.
- If client seems frustrated, acknowledge their feelings and try to help.
- For urgent issues, assure them someone will follow up quickly.`;

    if (knowledgeBase && knowledgeBase.length > 0) {
      prompt += '\n\nBusiness Knowledge Base:\n';
      for (const kb of knowledgeBase) {
        prompt += `- ${kb.title}: ${kb.content}\n`;
      }
    }

    if (serviceStatus && serviceStatus.length > 0) {
      prompt += '\n\nCurrent Service Status:\n';
      for (const s of serviceStatus) {
        if (s.status !== 'operational') {
          prompt += `- ${s.service_name}: ${s.status} — ${s.message}\n`;
        }
      }
    }

    return prompt;
  }

  _buildMessages(history, currentMessage, senderName) {
    const messages = [];

    // Add conversation history as context
    if (history && history.length > 0) {
      for (const msg of history) {
        messages.push({
          role: msg.sender_type === 'client' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }
    }

    // Add current message
    messages.push({
      role: 'user',
      parts: [{ text: currentMessage }],
    });

    return messages;
  }

  async _checkBudget(tenantId) {
    const result = await query(
      'SELECT plan, trial_budget_remaining FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (!result.rows[0]) return false;

    const { plan, trial_budget_remaining } = result.rows[0];
    if (plan === 'trial' && parseFloat(trial_budget_remaining) <= 0) {
      return false;
    }
    return true;
  }

  async _trackUsage(tenantId, tokensUsed) {
    // Estimate cost (Gemini Flash Lite is very cheap: ~$0.075 per 1M tokens)
    const costPerToken = 0.000000075;
    const cost = tokensUsed * costPerToken;
    const today = new Date().toISOString().split('T')[0];

    await query(
      `UPDATE tenants SET ai_tokens_used = ai_tokens_used + $1 WHERE id = $2`,
      [tokensUsed, tenantId]
    );

    // Deduct from trial budget if on trial
    await query(
      `UPDATE tenants SET trial_budget_remaining = GREATEST(0, trial_budget_remaining - $1)
       WHERE id = $2 AND plan = 'trial'`,
      [cost, tenantId]
    );

    // Update daily usage
    await query(
      `INSERT INTO usage_daily (tenant_id, date, ai_tokens_used, ai_replies_sent, cost_usd)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (tenant_id, date)
       DO UPDATE SET ai_tokens_used = usage_daily.ai_tokens_used + $3,
                     ai_replies_sent = usage_daily.ai_replies_sent + 1,
                     cost_usd = usage_daily.cost_usd + $4`,
      [tenantId, today, tokensUsed, cost]
    );
  }
}

module.exports = new AIEngine();
