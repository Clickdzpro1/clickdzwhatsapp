import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', businessName: '', businessType: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [services, setServices] = useState([]);
  const [newService, setNewService] = useState({ serviceName: '', status: 'operational', message: '' });
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.get('/settings').then(data => {
      setForm({ name: data.name || '', businessName: data.business_name || '', businessType: data.business_type || '' });
    });
    api.get('/settings/service-status').then(data => setServices(data.services || []));
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    await api.patch('/settings', form);
    setSaved('Profile saved');
    setTimeout(() => setSaved(''), 2000);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.patch('/settings/password', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      setSaved('Password changed');
      setTimeout(() => setSaved(''), 2000);
    } catch (err) {
      alert('Failed to change password');
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

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        {saved && <span style={{ color: 'var(--success)', fontSize: 14 }}>{saved}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Profile</h3>
          <form onSubmit={saveProfile}>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Business Name</label>
              <input value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Business Type</label>
              <input value={form.businessType} onChange={e => setForm({ ...form, businessType: e.target.value })} placeholder="e.g. Retail, Services" />
            </div>
            <button type="submit" className="btn btn-primary">Save</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Change Password</h3>
          <form onSubmit={changePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" value={passwords.currentPassword} onChange={e => setPasswords({ ...passwords, currentPassword: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={passwords.newPassword} onChange={e => setPasswords({ ...passwords, newPassword: e.target.value })} required minLength={6} />
            </div>
            <button type="submit" className="btn btn-primary">Change Password</button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Service Status Alerts</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
          When a service is down or degraded, the AI will inform clients automatically.
        </p>

        <form onSubmit={addService} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input placeholder="Service name" value={newService.serviceName} onChange={e => setNewService({ ...newService, serviceName: e.target.value })} required style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8 }} />
          <select value={newService.status} onChange={e => setNewService({ ...newService, status: e.target.value })} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
            <option value="operational">Operational</option>
            <option value="degraded">Degraded</option>
            <option value="down">Down</option>
            <option value="maintenance">Maintenance</option>
          </select>
          <button type="submit" className="btn btn-primary">Add</button>
        </form>

        {services.length > 0 && (
          <table>
            <thead>
              <tr><th>Service</th><th>Status</th><th>Message</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id}>
                  <td>{s.service_name}</td>
                  <td>
                    <span className={`badge ${s.status === 'operational' ? 'badge-new' : s.status === 'down' ? 'badge-urgent' : 'badge-high'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{s.message || '—'}</td>
                  <td>
                    <select
                      value={s.status}
                      onChange={e => updateServiceStatus(s.id, e.target.value)}
                      style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                    >
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
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Subscription</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Plan: <strong>{user?.plan}</strong> &bull;
          {user?.plan === 'trial' && ` Trial budget: $${user?.trialBudgetRemaining?.toFixed(2)} remaining`}
          {user?.plan !== 'trial' && ` Status: ${user?.status}`}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
          AI tokens used: {user?.aiTokensUsed?.toLocaleString()} &bull; Messages processed: {user?.messagesProcessed?.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
