import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Smartphone, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

export default function WhatsAppSetupPage() {
  const { user, setUser } = useAuth();
  const [status, setStatus] = useState('loading');
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');

  const checkStatus = async () => {
    try {
      const data = await api.get('/whatsapp/status');
      setStatus(data.status);
      if (data.status === 'connected') {
        // Refresh user data
        const me = await api.get('/auth/me');
        setUser(me);
      }
    } catch (err) {
      setStatus('error');
    }
  };

  useEffect(() => { checkStatus(); }, []);

  const connect = async () => {
    setError('');
    setStatus('connecting');
    try {
      const data = await api.post('/whatsapp/connect');
      setStatus(data.status);
      if (data.qr) setQr(data.qr);

      // Poll for connection
      if (data.status !== 'connected') {
        const interval = setInterval(async () => {
          try {
            const s = await api.get('/whatsapp/status');
            setStatus(s.status);
            if (s.status === 'connected') {
              clearInterval(interval);
              setQr(null);
              const me = await api.get('/auth/me');
              setUser(me);
            } else if (s.status === 'qr_ready') {
              const qrData = await api.get('/whatsapp/qr');
              if (qrData.qr) setQr(qrData.qr);
            }
          } catch (e) {
            clearInterval(interval);
          }
        }, 3000);

        // Stop polling after 2 minutes
        setTimeout(() => clearInterval(interval), 120000);
      }
    } catch (err) {
      setError(err.message || 'Connection failed');
      setStatus('error');
    }
  };

  const disconnect = async () => {
    await api.post('/whatsapp/disconnect');
    setStatus('disconnected');
    setQr(null);
    const me = await api.get('/auth/me');
    setUser(me);
  };

  const logout = async () => {
    if (!confirm('This will log out your WhatsApp. You will need to scan QR again.')) return;
    await api.post('/whatsapp/logout');
    setStatus('disconnected');
    setQr(null);
    const me = await api.get('/auth/me');
    setUser(me);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>WhatsApp Connection</h2>
      </div>

      <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="qr-container">
          {status === 'connected' ? (
            <>
              <CheckCircle size={64} color="var(--success)" />
              <h3>WhatsApp Connected</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                Your WhatsApp is linked. The AI assistant is active and will auto-reply to messages.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
                <button className="btn btn-danger" onClick={logout}>Logout & Reset</button>
              </div>
            </>
          ) : status === 'qr_ready' && qr ? (
            <>
              <h3>Scan QR Code</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device</p>
              <img src={qr} alt="WhatsApp QR Code" />
              <button className="btn btn-secondary" onClick={connect}>
                <RefreshCw size={14} /> Refresh QR
              </button>
            </>
          ) : status === 'connecting' ? (
            <>
              <RefreshCw size={48} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
              <h3>Connecting...</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Preparing your WhatsApp bridge</p>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </>
          ) : (
            <>
              <Smartphone size={64} color="var(--primary)" />
              <h3>Connect Your WhatsApp</h3>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                Link your WhatsApp to enable AI auto-replies. Just scan a QR code — takes 10 seconds.
              </p>
              {error && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
              <button className="btn btn-primary" onClick={connect}>
                <Smartphone size={16} /> Connect Now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
