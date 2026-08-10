import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Smartphone, CheckCircle, RefreshCw, Link, Unlink,
  AlertTriangle, Bot, Shield, Wifi, WifiOff, Hash, KeyRound
} from 'lucide-react';

/**
 * WhatsApp connection page.
 *
 * Wave 0 fixes:
 *  1. The QR image is fed a data URL *string*, not the response envelope
 *     (was: <img src={qr}> where qr was the whole { status, qr } object,
 *      which the browser rendered as "[object Object]" — producing the
 *      "keeps refreshing" symptoms).
 *  2. Pair-by-Code is the new primary CTA. The QR rotates every ~30s on
 *     a long relay; the 8-char code lives minutes and can be re-requested.
 *  3. We no longer create a new bridge on every poll. /v2/* proxies to the
 *     Railway gateway when USE_RAILWAY_GATEWAY=true; otherwise falls back
 *     to the legacy in-process bridge so existing tenants still work.
 */
export default function WhatsAppSetupPage() {
  const { user, setUser } = useAuth();
  const [status, setStatus] = useState('loading');
  const [qr, setQr] = useState(null);
  const [lastQrStr, setLastQrStr] = useState(null); // de-dup image src
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  // Pair-by-Code state
  const [phoneInput, setPhoneInput] = useState('');
  const [pairCode, setPairCode] = useState(null); // { code, formatted, expiresInHint }
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');

  // Multi-instance support (Wave 1 prep): server returns a list of instances.
  const [instances, setInstances] = useState([]);

  const refreshUser = async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me);
    } catch { /* ignore */ }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchInstanceList = async () => {
    try {
      const r = await api.get('/whatsapp/v2/instances');
      setInstances(Array.isArray(r?.instances) ? r.instances : []);
    } catch { /* ignore */ }
  };

  const checkStatus = async () => {
    try {
      const data = await api.get('/whatsapp/v2/status');
      setStatus(data.status);
      if (data.status === 'connected') {
        stopPolling();
        await refreshUser();
        await fetchInstanceList();
      }
    } catch (err) {
      setStatus('error');
    }
  };

  useEffect(() => {
    checkStatus();
    fetchInstanceList();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = () => {
    stopPolling();
    const id = setInterval(async () => {
      try {
        const s = await api.get('/whatsapp/v2/status');
        setStatus(s.status);
        if (s.status === 'connected') {
          stopPolling();
          setQr(null);
          setLastQrStr(null);
          setPairCode(null);
          await refreshUser();
          await fetchInstanceList();
          return;
        }
        if (s.status === 'qr_ready') {
          const qrData = await api.get('/whatsapp/v2/qr');
          // FIX (Wave 0): extract the data URL string. Response shape is
          // { status, qr: 'data:image/png;base64,…' }. Previously we
          // assigned the envelope and fed it into <img src>.
          if (qrData?.qr && qrData.qr !== lastQrStr) {
            setLastQrStr(qrData.qr);
            setQr(qrData.qr);
          }
        }
      } catch {
        stopPolling();
      }
    }, 3000);
    pollRef.current = id;
    // Safety net: stop polling after 2 minutes regardless.
    setTimeout(stopPolling, 120000);
  };

  const connect = async () => {
    setError('');
    setStatus('connecting');
    setPairCode(null);
    setPairError('');
    try {
      const data = await api.post('/whatsapp/v2/connect');
      setStatus(data.status);
      if (data.status === 'qr_ready' && data.qr) {
        setLastQrStr(data.qr);
        setQr(data.qr);
      }
      if (data.status !== 'connected') startPolling();
      else {
        await refreshUser();
        await fetchInstanceList();
      }
    } catch (err) {
      setError(err.message || 'Connection failed');
      setStatus('error');
    }
  };

  const requestPairCode = async () => {
    setPairBusy(true);
    setPairError('');
    setError('');
    try {
      // 1. Make sure a session is in 'qr' state by triggering connect first.
      const c = await api.post('/whatsapp/v2/connect');
      setStatus(c.status);
      if (c.status === 'connected') {
        await refreshUser();
        await fetchInstanceList();
        setPairBusy(false);
        return;
      }
      if (c.qr) {
        setLastQrStr(c.qr);
        setQr(c.qr);
      }
      // 2. Ask the gateway for the 8-char pairing code.
      const digits = phoneInput.replace(/[^\d]/g, '');
      const r = await api.post('/whatsapp/v2/pair-code', { phoneNumber: digits });
      setPairCode({
        code: r.code,
        formatted: r.formatted,
        expiresInHint: r.expiresInHint,
        phoneNumber: r.phoneNumber,
      });
      // Pair-by-code lives for minutes, so the QR is now secondary.
      if (c.status !== 'connected') startPolling();
    } catch (err) {
      setPairError(err.message || 'Failed to request pairing code');
    } finally {
      setPairBusy(false);
    }
  };

  const disconnect = async () => {
    stopPolling();
    try {
      await api.post('/whatsapp/v2/disconnect');
      // Disconnect can mean logging out or stopping; ask server what state we're in.
      const s = await api.get('/whatsapp/v2/status');
      setStatus(s.status);
      if (s.status !== 'connected') setQr(null);
      setPairCode(null);
      await refreshUser();
      await fetchInstanceList();
    } catch (err) {
      setError(err.message || 'Disconnect failed');
    }
  };

  const logout = async () => {
    const confirmed = window.confirm(
      'This will log out your WhatsApp session. You will need to scan the QR code (or enter a new 8-digit pairing code) again.'
    );
    if (!confirmed) return;
    stopPolling();
    try {
      await api.post('/whatsapp/v2/logout');
      setStatus('disconnected');
      setQr(null);
      setLastQrStr(null);
      setPairCode(null);
      await refreshUser();
    } catch (err) {
      setError(err.message || 'Logout failed');
    }
  };

  const isLoading = status === 'loading' || status === 'connecting';

  // Render
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
            {instances.length > 1 && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                You have {instances.length} linked numbers. Manage each one's ACL from the team page.
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 48 }}>
            <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto 16px', borderWidth: 3 }} />
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>
              {status === 'loading' ? 'Checking connection...' : 'Starting WhatsApp bridge...'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>This may take a few seconds</p>
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 20, padding: 32 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Connect a WhatsApp number</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              Open WhatsApp on your phone → Settings → Linked Devices. Either scan the QR code below, or
              generate an 8-digit pairing code to type instead (recommended when the QR keeps timing out).
            </p>

            {error && (
              <div className="alert alert-danger" style={{ textAlign: 'left', marginBottom: 16 }}>
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            {/* Pair-by-Code is the recommended path: 8-char code lives minutes; survives the QR rotation. */}
            <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <KeyRound size={14} color="var(--green)" />
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>Pair by 8-digit code (recommended)</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Phone with country code, e.g. 213555123456"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit',
                  }}
                  data-testid="pair-phone-input"
                />
                <button
                  className="btn btn-primary"
                  onClick={requestPairCode}
                  disabled={pairBusy || phoneInput.replace(/\D/g, '').length < 8}
                >
                  <Hash size={14} /> {pairBusy ? 'Generating…' : 'Get code'}
                </button>
              </div>
              {pairError && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{pairError}</div>
              )}
              {pairCode && (
                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Type this on your phone</div>
                  <div
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 36, fontWeight: 700, letterSpacing: 6, color: 'var(--green)',
                      userSelect: 'all',
                    }}
                    data-testid="pair-code"
                  >
                    {pairCode.formatted || pairCode.code}
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onClick={requestPairCode}
                    disabled={pairBusy}
                  >
                    <RefreshCw size={12} /> {pairBusy ? 'Working…' : 'Regenerate code'}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    {pairCode.expiresInHint || 'Code lives a few minutes; re-request anytime.'}
                  </div>
                </div>
              )}
            </div>

            {/* QR fallback: renders a scannable image. src is the data URL string, not an object. */}
            {qr && status !== 'connected' && (
              <div style={{ textAlign: 'center', padding: 16 }} data-testid="qr-fallback">
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  …or scan this QR (rotates ~every 30 seconds):
                </div>
                <div className="qr-container" style={{ margin: '0 auto 12px', display: 'inline-block' }}>
                  <img
                    src={qr}
                    alt="WhatsApp QR Code"
                    style={{ width: 220, height: 220, display: 'block' }}
                  />
                </div>
                <button className="btn btn-secondary" onClick={connect}>
                  <RefreshCw size={14} /> Refresh QR
                </button>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  Waiting for scan… this page auto-refreshes the image only when the QR string actually changes.
                </div>
              </div>
            )}

            {!qr && !pairCode && !isLoading && (
              <div style={{ textAlign: 'center', padding: 8 }}>
                <button className="btn btn-primary btn-lg" onClick={connect} disabled={pairBusy}>
                  <Wifi size={16} /> Start connection
                </button>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  Or enter your phone number above and click "Get code" — much faster than scanning for most users.
                </p>
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>How it works</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { step: '1', icon: Smartphone, title: 'Link a WhatsApp number', desc: 'Use your phone app — scan a QR or type an 8-digit code. No extra setup required.' },
              { step: '2', icon: Bot, title: 'AI takes over', desc: 'The AI reads your knowledge base and starts auto-replying to customer messages.' },
              { step: '3', icon: Shield, title: 'Stay in control', desc: 'Take over any conversation manually. The AI always defers to you.' },
              { step: '4', icon: Link, title: 'Many numbers, one place', desc: 'Add as many WhatsApp numbers as you need and route them to different team members.' },
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
