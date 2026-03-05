import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Search, Users, MessageSquare, Star, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TYPE_BADGE = {
  new: 'badge-blue',
  returning: 'badge-green',
  vip: 'badge-yellow',
  blocked: 'badge-red',
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filter) params.set('clientType', filter);
    api.get(`/contacts?${params}`).then(data => {
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
    });
  }, [search, filter]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Contacts</h2>
          <p className="page-subtitle">{total} total contacts</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="conv-list-search" style={{ maxWidth: 280 }}>
          <Search size={14} />
          <input
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {['', 'new', 'returning', 'vip', 'blocked'].map(t => (
          <button key={t} className={`filter-chip ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
            {t || 'All'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Tags</th>
                <th>Last Seen</th>
                <th>Conversations</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state" style={{ padding: 48 }}>
                      <div className="empty-state-icon"><Users size={22} color="var(--text-muted)" /></div>
                      <h3>No contacts yet</h3>
                      <p>Contacts are created automatically when someone messages your WhatsApp.</p>
                    </div>
                  </td>
                </tr>
              ) : contacts.map(c => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                        {(c.name || c.push_name || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name || c.push_name || 'Unknown'}</div>
                        {c.push_name && c.name && c.push_name !== c.name && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.push_name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 13 }}>
                    {c.phone || c.whatsapp_jid?.split('@')[0]}
                  </td>
                  <td>
                    <span className={`badge ${TYPE_BADGE[c.client_type] || 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                      {c.client_type || 'unknown'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(c.tags || []).map(tag => (
                        <span key={tag} className="badge badge-gray" style={{ fontSize: 10 }}>
                          <Tag size={9} /> {tag}
                        </span>
                      ))}
                      {(!c.tags || c.tags.length === 0) && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td>
                    <span className="badge badge-gray">{c.conversation_count || 0}</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title="View conversations"
                      onClick={() => navigate('/conversations')}
                    >
                      <MessageSquare size={14} />
                    </button>
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
