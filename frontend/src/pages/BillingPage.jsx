import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { CreditCard, Zap, CheckCircle, ArrowRight, TrendingUp, Bot, Activity } from 'lucide-react';

const plans = [
  {
    id: 'weekly',
    name: 'Weekly',
    price: '$7',
    period: '/week',
    features: [
      'Unlimited WhatsApp conversations',
      'AI auto-replies (Gemini powered)',
      'Knowledge base (unlimited entries)',
      'Reply templates',
      'Human takeover',
      'Real-time dashboard',
      'Contact management',
    ],
    highlight: true,
  },
];

export default function BillingPage() {
  const { user } = useAuth();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/billing/subscription').then(data => setUsage(data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  const isActive = user?.plan !== 'trial' && user?.status === 'active';
  const isTrial = user?.plan === 'trial';
  const trialLeft = parseFloat(user?.trialBudgetRemaining || 0);
  const trialTotal = 5;
  const trialUsed = trialTotal - trialLeft;
  const trialPct = Math.min(100, Math.round((trialUsed / trialTotal) * 100));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Billing & Plan</h2>
          <p className="page-subtitle">Manage your subscription and usage</p>
        </div>
      </div>

      {/* Current Status */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Current Plan</h3>
              <span className={`badge ${isActive ? 'badge-green' : isTrial ? 'badge-yellow' : 'badge-red'}`} style={{ textTransform: 'capitalize' }}>
                {isActive ? 'Active' : isTrial ? 'Trial' : user?.status || 'Inactive'}
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, textTransform: 'capitalize' }}>
              {user?.plan || 'Trial'}
            </div>
            {isTrial && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <span>Trial budget used</span>
                  <span>${trialUsed.toFixed(2)} / ${trialTotal.toFixed(2)}</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${trialPct}%`,
                    background: trialPct > 80 ? 'var(--danger)' : trialPct > 50 ? 'var(--warning)' : 'var(--green)',
                    borderRadius: 3,
                    transition: 'width 0.5s',
                  }} />
                </div>
                <div style={{ fontSize: 12, color: trialLeft < 1 ? 'var(--danger)' : 'var(--text-muted)', marginTop: 4 }}>
                  ${trialLeft.toFixed(2)} remaining
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>AI tokens used:</span>
              <strong>{(user?.aiTokensUsed || 0).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Messages processed:</span>
              <strong>{(user?.messagesProcessed || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Usage stats */}
      {!loading && usage && (
        <div className="card-grid" style={{ marginBottom: 24 }}>
          {[
            { label: 'Messages this week', value: usage.weekly_messages || 0, icon: Activity, color: 'var(--info)' },
            { label: 'AI replies this week', value: usage.weekly_ai_replies || 0, icon: Bot, color: '#a78bfa' },
            { label: 'Cost this week', value: `$${(usage.weekly_cost || 0).toFixed(4)}`, icon: TrendingUp, color: 'var(--warning)' },
          ].map(s => (
            <div key={s.label} className="card stat-card">
              <div className="stat-icon" style={{ background: `${s.color}20` }}>
                <s.icon size={18} color={s.color} />
              </div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: 24 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Plan cards */}
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Available Plans</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {plans.map(plan => (
          <div key={plan.id} className="card" style={{
            border: plan.highlight ? '1px solid rgba(37,211,102,0.4)' : '1px solid var(--border)',
            position: 'relative',
          }}>
            {plan.highlight && (
              <div style={{ position: 'absolute', top: -12, left: 20 }}>
                <span className="badge badge-green">Most Popular</span>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                {plan.name}
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>
                {plan.price}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>{plan.period}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {plan.features.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <CheckCircle size={14} color="var(--green)" />
                  {f}
                </div>
              ))}
            </div>

            {isActive ? (
              <div className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', pointerEvents: 'none' }}>
                <CheckCircle size={14} color="var(--green)" /> Current Plan
              </div>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => alert('Payment integration coming soon. Contact support to activate.')}>
                <CreditCard size={14} /> Subscribe — {plan.price}{plan.period}
              </button>
            )}
          </div>
        ))}

        {/* Custom / Enterprise */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 32, background: 'var(--bg-elevated)', border: '1px dashed var(--border-light)' }}>
          <Zap size={28} color="var(--text-muted)" style={{ marginBottom: 12 }} />
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Enterprise</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Multiple agents, custom integrations, white-label, SLA support.
          </div>
          <button className="btn btn-secondary" onClick={() => alert('Contact us at support@clickdz.com')}>
            Contact Sales <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
