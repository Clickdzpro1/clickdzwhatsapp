import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Smartphone, CheckCircle, XCircle, RefreshCw, Link, Unlink,
  AlertTriangle, Bot, Shield, Wifi, WifiOff
} from 'lucide-react';

export default function WhatsAppSetupPage() {
  const { user, setUser } = useAuth();
  const [status, setStatus] = useState('loading');
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');
  const [pollInterval, setPollInterval] = useState(null);

  const refreshUser = async () => {
    const me = await api.get('/auth/me');
    setUser(me);
  };

  const checkStatus = async () => {
    try {
      const data = await api.get('/whatsapp/status');
      setStatus(data.status);
      if (data.status === 'connected') await refreshUser();
    } catch (err) {
      setStatus('error');
    }
  };

  useEffect(() => {
    checkStatus();
    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, []);

  const startPolling = () => {
    const interval = setInterval(async () => {
      try {
        const s = await api.get('/whatsapp/status');
        setStatus(s.status);
        if (s.status === 'connected') {
          clearInterval(interval);
          setPollInterval(null);
          setQr(null);
          await refreshUser();
        } else if (s.status === 'qr_ready') {
          const qrData = await api.get('/whatsapp/qr');
          if (qrData.qr) setQr(qrData.qr);
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 3000);
    setPollInterval(interval);
    setTimeout(() => { clearInterval(interval); setPollInterval(null); }, 120000);
  };

  const connect = async () => {
    setError('');
    setStatus('connecting');
    try {
      const data = await api.post('/whatsapp/connect');
      setStatus(data.status);
      if (data.qr) setQr(data.qr);
      if (data.status !== 'connected') startPolling();
      else await refreshUser();
    } catch (err) {
      setError(err.message || 'Connection failed');
      setStatus('error');
    }
  };

  const disconnect = async () => {
    if (pollInterval) { clearInterval(pollInterval); setPollInterval(null); }
    await api.post('/whatsapp/disconnect');
    setStatus('disconnected');
    setQr(null);
    await refreshUser();
  };

  const logout = async () => {
    if (!confirm('This will log out your WhatsApp session. You will need to scan the QR code again.')) return;
    if (pollInterval) { clearInterval(pollInterval); setPollInterval(null); }
    await api.post('/whatsapp/logout');
    setStatus('disconnected');
    setQr(null);
    await refreshUser();
  };

  const isLoading = status === 'loading' || status === 'connecting';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">WhatsApp Connection</h2>
          <p className="page-subtitle">Link your WhatsApp to enable AI auto-replies</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-dot ${status === 'connected' ? 'green' : status === 'connecting' ? 'yellow' : 'red'}`} />
          <span style={{ fontSize: 13, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
            {status === 'loading' ? 'Checking...' : status}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Status card */}
        {status === 'connected' ? (
          <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 40 }}>
            <div style={{ width: 72, height: 72, background: 'rgba(34,197,94,0.15)', border: '2px solid var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <CheckCircle size={36} color="var(--success)" />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>WhatsApp Connected</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              Your WhatsApp is linked and active. The AI assistant is auto-replying to incoming messages.
            </p>
            <div className="connection-status" style={{ marginBottom: 24, justifyContent: 'center' }}>
              <Bot size={16} color="var(--green)" />
              <span style={{ fontSize: 13 }}>AI is active and handling conversations</span>
              <span className="badge badge-green">Live</span>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={disconnect}>
                <WifiOff size={14} /> Disconnect
              </button>
              <button className="btn btn-danger" onClick={logout}>
                <Unlink size={14} /> Logout & Reset Session
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 48 }}>
            <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto 16px', borderWidth: 3 }} />
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>
              {status === 'loading' ? 'Checking connection...' : 'Starting WhatsApp bridge...'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>This may take a few seconds</p>
          </div>
        ) : status === 'qr_ready' && qr ? (
          <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 40 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Scan QR Code</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
            </p>
            <div className="qr-container" style={{ margin: '0 auto 24px', display: 'inline-block' }}>
              <img src={qr} alt="WhatsApp QR Code" style={{ width: 220, height: 220, display: 'block' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={connect}>
                <RefreshCw size={14} /> Refresh QR
              </button>
              <button className="btn btn-ghost" onClick={() => setStatus('disconnected')}>
                Cancel
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
              QR expires in ~60 seconds. Waiting for scan...
            </p>
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 48 }}>
            <div style={{ width: 72, height: 72, background: 'var(--bg-elevated)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <Smartphone size={32} color="var(--text-muted)" />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Connect Your WhatsApp</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 8, maxWidth: 400, margin: '0 auto 20px' }}>
              Link your WhatsApp number to enable AI auto-replies. Just scan a QR code — takes 10 seconds.
            </p>
            {error && <div className="alert alert-danger" style={{ textAlign: 'left', marginBottom: 16 }}>
              <AlertTriangle size={14} /> {error}
            </div>}
            <button className="btn btn-primary btn-lg" onClick={connect}>
              <Wifi size={16} /> Connect Now
            </button>
          </div>
        )}

        {/* How it works */}
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>How it works</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { step: '1', icon: Smartphone, title: 'Scan the QR code', desc: 'Use the WhatsApp mobile app to scan — no extra setup required.' },
              { step: '2', icon: Bot, title: 'AI takes over', desc: 'The AI reads your knowledge base and starts auto-replying to customer messages.' },
              { step: '3', icon: Shield, title: 'Stay in control', desc: 'Take over any conversation manually. The AI always defers to you.' },
            ].map(item => (
              <div key={item.step} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, background: 'var(--green-glow)', border: '1px solid rgba(37,211,102,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{item.step}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
