import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, Lock, User, Building, Server, AlertTriangle, Bot, Plus } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', businessName: '', businessType: '' });
  const [aiSettings, setAiSettings] = useState({ tone: 'professional', language: 'auto', maxResponseLength: 300 });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [services, setServices] = useState([]);
  const [newService, setNewService] = useState({ serviceName: '', status: 'operational', message: '' });
  const [saved, setSaved] = useState('');
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    api.get('/settings').then(data => {
      setForm({ name: data.name || '', businessName: data.business_name || '', businessType: data.business_type || '' });
      if (data.settings) {
        setAiSettings(prev => ({ ...prev, ...data.settings }));
      }
    });
    api.get('/settings/service-status').then(data => setServices(data.services || []));
  }, []);

  const flash = (msg) => { setSaved(msg); setTimeout(() => setSaved(''), 2500); };

  const saveProfile = async (e) => {
    e.preventDefault();
    await api.patch('/settings', form);
    flash('Profile saved');
  };

  const saveAI = async (e) => {
    e.preventDefault();
    await api.patch('/settings', { settings: aiSettings });
    flash('AI settings saved');
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.patch('/settings/password', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      flash('Password changed');
    } catch (err) {
      alert(err.message || 'Failed to change password');
    }
  };

  const addService = async (e) => {
    e.preventDefault();
    await api.post('/settings/service-status', newService);
    setNewService({ serviceName: '', status: 'operational', message: '' });
    const data = await api.get('/settings/service-status');
    setServices(data.services || []);
  };

  const updateServiceStatus = async (id, status) => {
    await api.patch(`/settings/service-status/${id}`, { status });
    const data = await api.get('/settings/service-status');
    setServices(data.services || []);
  };

  const STATUS_BADGE = { operational: 'badge-green', degraded: 'badge-yellow', down: 'badge-red', maintenance: 'badge-blue' };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-subtitle">Configure your account, AI behavior, and service alerts</p>
        </div>
        {saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 13.5 }}>
            <CheckCircle size={15} /> {saved}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {[
          { key: 'profile', label: 'Profile', icon: User },
          { key: 'ai', label: 'AI Behavior', icon: Bot },
          { key: 'security', label: 'Security', icon: Lock },
          { key: 'services', label: 'Service Status', icon: Server },
        ].map(t => (
          <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
            <t.icon size={13} style={{ marginRight: 4 }} />{t.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div style={{ maxWidth: 520 }}>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Business Profile</h3>
            <form onSubmit={saveProfile}>
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Business Name</label>
                <input className="input" value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Business Type</label>
                <select className="select" value={form.businessType} onChange={e => setForm({ ...form, businessType: e.target.value })}>
                  <option value="">Select type</option>
                  <option value="ecommerce">E-commerce</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="services">Services</option>
                  <option value="retail">Retail</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">Save Profile</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div style={{ maxWidth: 520 }}>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>AI Behavior</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Configure how the AI responds to your customers.
            </p>
            <form onSubmit={saveAI}>
              <div className="form-group">
                <label className="form-label">Response Tone</label>
                <select className="select" value={aiSettings.tone} onChange={e => setAiSettings({ ...aiSettings, tone: e.target.value })}>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="casual">Casual</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Language</label>
                <select className="select" value={aiSettings.language} onChange={e => setAiSettings({ ...aiSettings, language: e.target.value })}>
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                  <option value="fr">French</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Max Response Length (characters)</label>
                <input className="input" type="number" min={50} max={1000} value={aiSettings.maxResponseLength}
                  onChange={e => setAiSettings({ ...aiSettings, maxResponseLength: parseInt(e.target.value) })} />
              </div>
              <button type="submit" className="btn btn-primary">Save AI Settings</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div style={{ maxWidth: 520 }}>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Change Password</h3>
            <form onSubmit={changePassword}>
              <div className="form-group">
                <label className="form-label">Current Password</label>
                <input className="input" type="password" value={passwords.currentPassword} onChange={e => setPasswords({ ...passwords, currentPassword: e.target.value })} required />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">New Password</label>
                <input className="input" type="password" value={passwords.newPassword} onChange={e => setPasswords({ ...passwords, newPassword: e.target.value })} required minLength={6} placeholder="Min 6 characters" />
              </div>
              <button type="submit" className="btn btn-primary">Update Password</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'services' && (
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Service Status Alerts</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              When a service is degraded or down, the AI will automatically inform customers and avoid promising unavailable services.
            </p>

            <form onSubmit={addService} style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Service name (e.g. Delivery)" value={newService.serviceName} onChange={e => setNewService({ ...newService, serviceName: e.target.value })} required />
              <select className="select" style={{ width: 160 }} value={newService.status} onChange={e => setNewService({ ...newService, status: e.target.value })}>
                <option value="operational">Operational</option>
                <option value="degraded">Degraded</option>
                <option value="down">Down</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Message (optional)" value={newService.message} onChange={e => setNewService({ ...newService, message: e.target.value })} />
              <button type="submit" className="btn btn-primary"><Plus size={14} /> Add</button>
            </form>

            {services.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Message</th>
                      <th>Updated</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.service_name}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[s.status] || 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{s.message || '—'}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {new Date(s.updated_at).toLocaleDateString()}
                        </td>
                        <td>
                          <select className="select" style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                            value={s.status} onChange={e => updateServiceStatus(s.id, e.target.value)}>
                            <option value="operational">Operational</option>
                            <option value="degraded">Degraded</option>
                            <option value="down">Down</option>
                            <option value="maintenance">Maintenance</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No services added yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
