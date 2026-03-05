import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { MessageSquare, Bot, User, AlertTriangle, TrendingUp, Smartphone } from 'lucide-react';

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

  if (loading) return <div className="page empty-state">Loading dashboard...</div>;

  const conv = stats?.conversations || {};
  const msgs = stats?.messagesToday || {};
  const contacts = stats?.contacts || {};

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Welcome back, {user?.name} — {user?.plan === 'trial' ? `Trial ($${user.trialBudgetRemaining?.toFixed(2)} remaining)` : `${user?.plan} plan`}
          </p>
        </div>
        {!user?.whatsappConnected && (
          <button className="btn btn-primary" onClick={() => navigate('/whatsapp-setup')}>
            <Smartphone size={16} /> Connect WhatsApp
          </button>
        )}
      </div>

      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card">
          <span className="label">Open Conversations</span>
          <span className="value">{conv.open || 0}</span>
          {parseInt(conv.escalated) > 0 && (
            <span style={{ color: 'var(--danger)', fontSize: 13 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {conv.escalated} escalated
            </span>
          )}
        </div>
        <div className="card stat-card">
          <span className="label">Messages Today</span>
          <span className="value">{parseInt(msgs.from_clients || 0) + parseInt(msgs.ai_replies || 0) + parseInt(msgs.human_replies || 0)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <Bot size={14} style={{ verticalAlign: -2 }} /> {msgs.ai_replies || 0} AI &bull;
            <User size={14} style={{ verticalAlign: -2 }} /> {msgs.human_replies || 0} human
          </span>
        </div>
        <div className="card stat-card">
          <span className="label">Total Contacts</span>
          <span className="value">{contacts.total || 0}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {contacts.new_clients || 0} new, {contacts.returning_clients || 0} returning
          </span>
        </div>
        <div className="card stat-card">
          <span className="label">Unread</span>
          <span className="value" style={{ color: parseInt(conv.unread) > 0 ? 'var(--primary)' : undefined }}>
            {conv.unread || 0}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 16 }}>Categories</h3>
          {stats?.categories?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.categories.map(cat => (
                <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ textTransform: 'capitalize' }}>{cat.category}</span>
                  <span className="badge badge-ai">{cat.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>No conversations yet</p>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 16 }}>Weekly Usage</h3>
          {usage.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {usage.map(day => (
                <div key={day.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{new Date(day.date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {day.messages_received || 0} msgs / {day.ai_replies_sent || 0} AI replies
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>No usage data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
