const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/database');
const { authenticate, checkTenantActive } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// Authenticated routes
router.use('/subscription', authenticate, checkTenantActive);
router.use('/payments', authenticate, checkTenantActive);

// GET /api/billing/subscription — current subscription
router.get('/subscription', async (req, res, next) => {
  try {
    const sub = await query(
      `SELECT * FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('active', 'past_due')
       ORDER BY created_at DESC LIMIT 1`,
      [req.tenant.id]
    );

    const tenant = await query(
      'SELECT plan, trial_budget_remaining, ai_tokens_used FROM tenants WHERE id = $1',
      [req.tenant.id]
    );

    res.json({
      subscription: sub.rows[0] || null,
      plan: tenant.rows[0]?.plan,
      trialBudgetRemaining: parseFloat(tenant.rows[0]?.trial_budget_remaining || 0),
      aiTokensUsed: tenant.rows[0]?.ai_tokens_used || 0,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/billing/subscribe — create subscription via SlickPay
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { plan, paymentMethod } = req.body;
    if (!['weekly', 'monthly'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const amount = plan === 'weekly' ? config.billing.weeklyPrice : config.billing.weeklyPrice * 4;

    if (paymentMethod === 'slickpay') {
      // Create SlickPay payment request
      const paymentData = {
        amount,
        currency: 'DZD',
        description: `ClickDz WhatsApp - ${plan} plan`,
        callbackUrl: `${config.frontendUrl}/api/billing/webhook/slickpay`,
        tenantId: req.tenant.id,
        plan,
      };

      // In production, this would call SlickPay API
      // For now, return a mock payment URL
      const paymentId = crypto.randomUUID();

      await query(
        `INSERT INTO payments (id, tenant_id, amount, currency, payment_method, status, metadata)
         VALUES ($1, $2, $3, 'DZD', 'slickpay', 'pending', $4)`,
        [paymentId, req.tenant.id, amount, JSON.stringify(paymentData)]
      );

      res.json({
        paymentId,
        paymentUrl: `https://pay.slickpay.dz/checkout/${paymentId}`,
        amount,
        plan,
      });
    } else {
      return res.status(400).json({ error: 'Unsupported payment method' });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/billing/webhook/slickpay — SlickPay callback
router.post('/webhook/slickpay', async (req, res, next) => {
  try {
    const { paymentId, status, transactionId } = req.body;

    // Verify signature (in production, verify HMAC with SlickPay secret)
    // const signature = req.headers['x-slickpay-signature'];

    const payment = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const paymentRow = payment.rows[0];

    if (status === 'completed') {
      // Update payment
      await query(
        `UPDATE payments SET status = 'completed', external_id = $1 WHERE id = $2`,
        [transactionId, paymentId]
      );

      const metadata = paymentRow.metadata;
      const plan = metadata.plan || 'weekly';
      const periodDays = plan === 'weekly' ? 7 : 30;

      // Create/update subscription
      await query(
        `INSERT INTO subscriptions (tenant_id, plan, status, payment_method, amount, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', 'slickpay', $3, NOW(), NOW() + ($4 || ' days')::INTERVAL)`,
        [paymentRow.tenant_id, plan, paymentRow.amount, periodDays]
      );

      // Update tenant plan
      await query(
        `UPDATE tenants SET plan = $1, status = 'active' WHERE id = $2`,
        [plan, paymentRow.tenant_id]
      );
    } else if (status === 'failed') {
      await query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [paymentId]);
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/billing/payments — payment history
router.get('/payments', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.tenant.id]
    );
    res.json({ payments: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
