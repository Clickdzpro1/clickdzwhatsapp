import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bot, Mail, Lock, ArrowRight, MessageSquare, Brain, Zap } from 'lucide-react';

const features = [
  { icon: MessageSquare, text: 'Unlimited WhatsApp conversations' },
  { icon: Brain, text: 'AI auto-replies powered by Gemini' },
  { icon: Zap, text: 'Human takeover in one click' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email, password });
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div style={{ display: 'flex', gap: 60, alignItems: 'center', width: '100%', maxWidth: 860, position: 'relative', zIndex: 1 }}>
        {/* Left panel */}
        <div style={{ flex: 1, display: 'none' }} className="auth-left-panel">
          <div style={{ marginBottom: 24 }}>
            <div className="sidebar-brand-icon" style={{ width: 48, height: 48, marginBottom: 16 }}>
              <Bot size={24} color="white" />
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              WhatsApp, <span className="text-green">Supercharged.</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
              Automate customer conversations with AI. Never miss a lead again.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {features.map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                <div style={{ width: 32, height: 32, background: 'var(--green-glow)', border: '1px solid rgba(37,211,102,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <f.icon size={15} color="var(--green)" />
                </div>
                {f.text}
              </div>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="auth-card" style={{ flex: '0 0 400px' }}>
          <div className="auth-logo">
            <div className="auth-logo-icon">
              <Bot size={28} color="white" />
            </div>
            <h1>Welcome back</h1>
            <p>Sign in to your AI dashboard</p>
          </div>

          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  style={{ paddingLeft: 34 }}
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="Your password"
                  style={{ paddingLeft: 34 }}
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? <span className="loading-spinner" style={{ width: 18, height: 18 }} /> : <>Sign In <ArrowRight size={16} /></>}
            </button>
          </form>

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5, color: 'var(--text-secondary)' }}>
            No account?{' '}
            <Link to="/register" style={{ color: 'var(--green)', fontWeight: 600, textDecoration: 'none' }}>
              Start free trial
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
