import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { getJwt } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Smartphone, CheckCircle, RefreshCw, Plus, Trash2,
  AlertTriangle, Bot, Shield, Wifi, WifiOff, Hash, KeyRound, Users
} from 'lucide-react';

/**
 * WhatsApp connection page (Wave 1).
 *
 * Why this is different from the Wave 0 page:
 *  - Lists every WhatsApp account a user has access to (multi-WhatsApp-per-user).
 *  - Subscribes to /ws/whatsapp so QR events come in real-time, no polling.
 *  - Pair-by-Code is still the primary CTA per instance (8-char code
 *    beats a rotating QR on slow networks).
 *  - Owners can grant another user access to one of their instances via
 *    the team dialog.
 *
 * Backwards compat: if no instances exist yet, the "Add your first
 * WhatsApp" button creates one and connects it. The Vercel JWT carries
 * user_id from Wave 1 onward; the SaaS routes use it for ACL.
 */

export default function WhatsAppSetupPage() {
  const { user, setUser } = useAuth();
  const [instances, setInstances] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const wsRef = useRef(null);

  // Wire realtime events from the gateway
  useEffect(() => {
    // WebSocket path: /ws/whatsapp?token=<jwt>
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/whatsapp?token=${encodeURIComponent(getJwt())}`);
    wsRef.current = ws;
    ws.onmessage = (m) => {
      let parsed;
      try { parsed = JSON.parse(m.data); } catch { return; }
      if (parsed.event === 'qr' && parsed.payload && parsed.payload.qr && parsed.instance_id) {
        setInstances((prev) => prev.map((i) => (
          i.id === parsed.instance_id
            ? { ...i, status: 'qr', hasQr: true, lastQr: parsed.payload.qr }
            : i
        )));
      } else if (parsed.event === 'connection.update' || parsed.type === 'replay') {
        // pull-to-refresh after replay to align local state with gateway truth
        fetchInstances().catch(() => {});
      } else if (parsed.event === 'instance.ready' && parsed.instance_id) {
        setInstances((prev) => prev.map((i) => (
          i.id === parsed.instance_id ? { ...i, status: 'connected' } : i
        )));
      } else if (parsed.event === 'instance.logged_out' && parsed.instance_id) {
        setInstances((prev) => prev.map((i) => (
          i.id === parsed.instance_id ? { ...i, status: 'logged_out', hasQr: false } : i
        )));
      }
    };
    ws.onerror = () => { /* gracefully degrade to HTTP — work still polls */ };
    return () => { try { ws.close(); } catch { /* ignore */ } };
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      const r = await api.get('/whatsapp/v2/instances');
      const items = Array.isArray(r?.instances) ? r.instances : [];
      setInstances(items);
      const anyConnected = items.some((i) => i.status === 'connected');
      setStatus(anyConnected ? 'connected' : (items.length ? 'partial' : 'empty'));
      return items;
    } catch (e) {
      setStatus('error');
      setError(e.message);
      return [];
    }
  }, []);

  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  const createInstance = async () => {
    setError('');
    const name = window.prompt(
      'Friendly name for this WhatsApp number? (e.g. Sales DZ, Support FR)',
      'Customer Service',
    );
    if (name === null) return;
    try {
      const created = await api.post('/whatsapp/v2/instances', { name: name.trim() || 'WhatsApp' });
      // The backend ran /connect already. Force a refresh to pick up the QR.
      await fetchInstances();
      // Open the QR refresh loop on the new instance.
      const list = await fetchInstances();
      const fresh = list.find((i) => i.id === created.id);
      if (fresh) startInstanceQrPoll(fresh.id);
    } catch (e) { setError(e.message); }
  };

  // Per-instance QR poll (kept as a fallback when WS is offline for any reason)
  const startInstanceQrPoll = (instanceId) => {
    const tick = async () => {
      try {
        const q = await api.get(`/whatsapp/v2/instances/${instanceId}/qr`);
        setInstances((prev) => prev.map((i) => (
          i.id === instanceId
            ? { ...i, status: q.status, hasQr: !!q.qr, lastQr: q.qr || i.lastQr }
            : i
        )));
      } catch { /* silent: WS will update */ }
    };
    tick();
    return setInterval(tick, 4000);
  };

  const requestPairCode = async (instanceId, phoneNumber) => {
    const r = await api.post(`/whatsapp/v2/instances/${instanceId}/pair`, { phoneNumber });
    return r;
  };

  const disconnectInstance = async (instanceId) => {
    if (!confirm('Disconnect this WhatsApp? Incoming messages will stop until you reconnect.')) return;
    await api.post(`/whatsapp/v2/instances/${instanceId}/disconnect`);
    await fetchInstances();
  };

  const logoutInstance = async (instanceId) => {
    if (!confirm('Log out of this WhatsApp? You will need to pair again.')) return;
    await api.post(`/whatsapp/v2/instances/${instanceId}/logout`);
    await fetchInstances();
  };

  const deleteInstance = async (instanceId) => {
    if (!confirm('Permanently remove this WhatsApp from your account? (You can pair a new number afterwards.)')) return;
    await api.delete(`/whatsapp/v2/instances/${instanceId}`);
    await fetchInstances();
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">WhatsApp Accounts</h2>
          <p className="page-subtitle">
            {instances.length === 0
              ? 'Link one or more WhatsApp numbers to enable AI auto-replies.'
              : `${instances.length} WhatsApp${instances.length === 1 ? '' : 's'} linked to your account.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={createInstance}>
          <Plus size={14} /> Add WhatsApp
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>
        <AlertTriangle size={14} /> {error}
      </div>}

      {instances.length === 0 && status !== 'loading' && (
        <EmptyState onAdd={createInstance} />
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {instances.map((inst) => (
          <InstanceCard
            key={inst.id}
            inst={inst}
            onPair={(phone) => requestPairCode(inst.id, phone)}
            onConnect={() => api.post(`/whatsapp/v2/instances/${inst.id}/connect`).then(fetchInstances)}
            onDisconnect={() => disconnectInstance(inst.id)}
            onLogout={() => logoutInstance(inst.id)}
            onDelete={() => deleteInstance(inst.id)}
          />
        ))}
      </div>

      <Footer />
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40, marginBottom: 16 }}>
      <div style={{ width: 64, height: 64, background: 'var(--bg-elevated)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <Smartphone size={28} color="var(--text-muted)" />
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>No WhatsApp yet</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        Pair your first number to start receiving messages. You can add more numbers any time.
      </p>
      <button className="btn btn-primary btn-lg" onClick={onAdd}>
        <Wifi size={16} /> Connect first WhatsApp
      </button>
    </div>
  );
}

function InstanceCard({ inst, onPair, onConnect, onDisconnect, onLogout, onDelete }) {
  const [phone, setPhone] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');
  const [pairCode, setPairCode] = useState(null);

  const handlePair = async () => {
    setPairBusy(true);
    setPairError('');
    try {
      const r = await onPair(phone);
      setPairCode(r);
    } catch (e) { setPairError(e.message); }
    finally { setPairBusy(false); }
  };

  const isLive = inst.status === 'connected';

  return (
    <div className="card" data-testid={`instance-${inst.id}`} style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`status-dot ${isLive ? 'green' : inst.status === 'qr' || inst.status === 'connecting' ? 'yellow' : 'red'}`} />
            <strong style={{ fontSize: 15 }}>{inst.name}</strong>
            {inst.phoneNumber && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {inst.phoneNumber}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Status: <strong style={{ textTransform: 'capitalize' }}>{inst.status}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {!isLive && (
            <button className="btn btn-ghost" onClick={onConnect}><Wifi size={12} /> Connect</button>
          )}
          {isLive && (
            <button className="btn btn-secondary" onClick={onDisconnect}><WifiOff size={12} /> Disconnect</button>
          )}
          <button className="btn btn-ghost" onClick={onLogout}><Trash2 size={12} /> Reset</button>
          <button className="btn btn-danger" onClick={onDelete}><Trash2 size={12} /> Delete</button>
        </div>
      </div>

      {!isLive && (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
            <KeyRound size={14} color="var(--green)" />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Pair by 8-digit code</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Phone with country code (e.g. 213555123456)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
              data-testid="pair-phone-input"
            />
            <button
              className="btn btn-primary"
              onClick={handlePair}
              disabled={pairBusy || phone.replace(/\D/g, '').length < 8}
            >
              <Hash size={14} /> {pairBusy ? 'Working…' : 'Get code'}
            </button>
          </div>
          {pairError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{pairError}</div>}
          {pairCode && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Type this on your phone</div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 32, fontWeight: 700, letterSpacing: 6, color: 'var(--green)',
                  userSelect: 'all',
                }}
                data-testid="pair-code"
              >
                {pairCode.formatted || pairCode.code}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {pairCode.expiresInHint || 'Code lives a few minutes; re-request anytime.'}
              </div>
              <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={handlePair} disabled={pairBusy}>
                <RefreshCw size={12} /> Regenerate
              </button>
            </div>
          )}

          {inst.lastQr && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                …or scan the QR (rotates every ~30 s)
              </summary>
              <div style={{ textAlign: 'center', padding: 12 }}>
                <img
                  src={inst.lastQr}
                  alt="WhatsApp QR"
                  style={{ width: 180, height: 180 }}
                />
                <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={onConnect}>
                  <RefreshCw size={12} /> Refresh QR
                </button>
              </div>
            </details>
          )}
        </div>
      )}

      {isLive && (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={14} color="var(--green)" />
          <span style={{ fontSize: 13 }}>AI is handling inbound messages</span>
          <span className="badge badge-green" style={{ marginLeft: 'auto' }}>Live</span>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 10, fontSize: 12 }}
            data-testid={`acl-${inst.id}`}
            onClick={() => onGrantAcl(inst.id)}
          >
            <Users size={12} /> Share with teammate
          </button>
        </div>
      )}
    </div>
  );
}

async function onGrantAcl(instanceId) {
  const email = window.prompt('Teammate email to invite (they must already have a user on this workspace):');
  if (!email) return;
  try {
    await api.post(`/whatsapp/v2/instances/${instanceId}/acl`, { email, role: 'agent' });
    alert(`Granted ${email} access. They will see this WhatsApp on their next refresh.`);
  } catch (e) {
    alert(`Could not grant: ${e.message}`);
  }
}

function Footer() {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>How it works</h3>
      <ol style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <li>Add a WhatsApp → enter your phone → click <strong>Get code</strong>.</li>
        <li>On your phone: Settings → Linked Devices → Link with phone number → enter the 8-digit code.</li>
        <li>Replies are sent from your WhatsApp; the AI handler takes over when you toggle auto-reply on.</li>
        <li>Add as many WhatsApp numbers as you want; route each to a specific teammate via Share.</li>
      </ol>
    </div>
  );
}
