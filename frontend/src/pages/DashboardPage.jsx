import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  MessageSquare, Bot, User, AlertTriangle, Smartphone,
  TrendingUp, Users, Clock, Zap, ArrowRight, Activity
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, meta, color = 'var(--green)', bg = 'var(--green-glow)' }) {
  return (
    <div className="card stat-card">
      <div className="stat-icon" style={{ background: bg }}>
        <Icon size={20} color={color} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {meta && <div className="stat-meta">{meta}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/dashboard/usage?days=7'),
    ]).then(([s, u]) => {
      setStats(s);
      setUsage(u.usage || []);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="empty-state" style={{ height: '100%' }}>
      <div className="loading-spinner" />
    </div>
  );

  const conv = stats?.conversations || {};
  const msgs = stats?.messagesToday || {};
  const contacts = stats?.contacts || {};
  const totalMsgs = parseInt(msgs.from_clients || 0) + parseInt(msgs.ai_replies || 0) + parseInt(msgs.human_replies || 0);
  const aiRate = totalMsgs > 0 ? Math.round((parseInt(msgs.ai_replies || 0) / totalMsgs) * 100) : 0;
  const maxUsage = Math.max(...usage.map(d => parseInt(d.messages_received || 0)), 1);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">
            Welcome back, <strong>{user?.name}</strong> &mdash;{' '}
            {user?.plan === 'trial'
              ? <span style={{ color: 'var(--warning)' }}>Trial (${parseFloat(user.trialBudgetRemaining || 0).toFixed(2)} left)</span>
              : <span style={{ textTransform: 'capitalize', color: 'var(--green)' }}>{user?.plan} plan</span>
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!user?.whatsappConnected && (
            <button className="btn btn-primary" onClick={() => navigate('/whatsapp-setup')}>
              <Smartphone size={15} /> Connect WhatsApp
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => navigate('/conversations')}>
            Conversations <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {!user?.whatsappConnected && (
        <div className="alert alert-warning">
          <Smartphone size={16} />
          <div>
            <strong>WhatsApp not connected.</strong> Connect to start automating messages.{' '}
            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--warning)' }} onClick={() => navigate('/whatsapp-setup')}>
              Connect now →
            </button>
          </div>
        </div>
      )}

      <div className="card-grid" style={{ marginBottom: 24 }}>
        <StatCard icon={MessageSquare} label="Open Conversations" value={conv.open || 0}
          meta={parseInt(conv.escalated) > 0 ? <><AlertTriangle size={12} color="var(--danger)" /> {conv.escalated} escalated</> : 'All handled'} />
        <StatCard icon={Activity} label="Messages Today" value={totalMsgs}
          meta={<><Bot size={12} /> {msgs.ai_replies || 0} AI &bull; <User size={12} /> {msgs.human_replies || 0} human</>}
          color="var(--info)" bg="rgba(59,130,246,0.12)" />
        <StatCard icon={Users} label="Total Contacts" value={contacts.total || 0}
          meta={`${contacts.new_clients || 0} new · ${contacts.returning_clients || 0} returning`}
          color="#a78bfa" bg="rgba(139,92,246,0.12)" />
        <StatCard icon={Clock} label="Unread" value={conv.unread || 0}
          meta={parseInt(conv.unread) > 0 ? 'Need attention' : 'All caught up'}
          color={parseInt(conv.unread) > 0 ? 'var(--warning)' : 'var(--success)'}
          bg={parseInt(conv.unread) > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)'} />
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>AI Automation Rate</h3>
            <span className="badge badge-ai"><Bot size={10} /> Today</span>
          </div>
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2, color: 'var(--green)' }}>{aiRate}%</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>messages handled by AI</div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              { label: 'AI replies', value: msgs.ai_replies || 0, color: '#a78bfa' },
              { label: 'Human', value: msgs.human_replies || 0, color: 'var(--green)' },
              { label: 'Inbound', value: msgs.from_clients || 0, color: 'var(--info)' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: 'center', background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 4px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Weekly Activity</h3>
            <span className="badge badge-blue"><TrendingUp size={10} /> 7 days</span>
          </div>
          {usage.length > 0 ? (
            <div>
              {usage.slice(-7).map(day => (
                <div key={day.date} className="chart-bar-row">
                  <div className="chart-bar-label">
                    {new Date(day.date).toLocaleDateString('en', { weekday: 'short' })}
                  </div>
                  <div className="chart-bar-track">
                    <div className="chart-bar-fill"
                      style={{ width: `${Math.round((parseInt(day.messages_received || 0) / maxUsage) * 100)}%` }} />
                  </div>
                  <div className="chart-bar-value">{day.messages_received || 0}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}>
              <p>No activity yet</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Conversation Categories</h3>
          {stats?.categories?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stats.categories.map(cat => (
                <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ textTransform: 'capitalize', fontSize: 13.5 }}>{cat.category || 'general'}</span>
                  <span className="badge badge-gray">{cat.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No data yet</p>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'View unread conversations', icon: MessageSquare, path: '/conversations', badge: parseInt(conv.unread) },
              { label: 'Train AI knowledge base', icon: Bot, path: '/knowledge-base' },
              { label: 'Manage reply templates', icon: Zap, path: '/templates' },
              { label: 'Manage contacts', icon: Users, path: '/contacts' },
            ].map(a => (
              <button key={a.path} className="btn btn-secondary"
                style={{ justifyContent: 'space-between', textAlign: 'left' }}
                onClick={() => navigate(a.path)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a.icon size={15} /> {a.label}
                </span>
                {a.badge > 0 ? <span className="badge badge-red">{a.badge}</span> : <ArrowRight size={14} color="var(--text-muted)" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
