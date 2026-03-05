import React, { useState, useEffect } from 'react';
import api from '../utils/api';

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    api.get(`/contacts?${params}`).then(data => {
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
    });
  }, [search]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Contacts ({total})</h2>
        <input
          className="search-input"
          style={{ maxWidth: 300 }}
          placeholder="Search contacts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone/JID</th>
                <th>Type</th>
                <th>Tags</th>
                <th>Last Message</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40 }}>No contacts yet</td></tr>
              ) : contacts.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.name || c.push_name || 'Unknown'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{c.phone || c.whatsapp_jid}</td>
                  <td>
                    <span className={`badge ${c.client_type === 'new' ? 'badge-new' : c.client_type === 'vip' ? 'badge-urgent' : 'badge-ai'}`}>
                      {c.client_type}
                    </span>
                  </td>
                  <td>{(c.tags || []).join(', ') || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
