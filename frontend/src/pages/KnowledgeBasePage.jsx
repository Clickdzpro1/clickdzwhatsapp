import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2, BookOpen, Search, Bot, X, CheckCircle } from 'lucide-react';

export default function KnowledgeBasePage() {
  const [items, setItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', category: '' });
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [saved, setSaved] = useState(false);

  const load = () => api.get('/knowledge-base').then(d => setItems(d.items || []));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm({ title: '', content: '', category: '' });
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setForm({ title: item.title, content: item.content, category: item.category || '' });
    setEditing(item.id);
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (editing) {
      await api.patch(`/knowledge-base/${editing}`, form);
    } else {
      await api.post('/knowledge-base', form);
    }
    setShowModal(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this knowledge base entry?')) return;
    await api.del(`/knowledge-base/${id}`);
    load();
  };

  const toggle = async (item) => {
    await api.patch(`/knowledge-base/${item.id}`, { isActive: !item.is_active });
    load();
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const filtered = items.filter(i => {
    const matchSearch = !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.content.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCat || i.category === filterCat;
    return matchSearch && matchCat;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Knowledge Base</h2>
          <p className="page-subtitle">Train your AI with products, pricing, and policies</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={15} /> Add Entry
        </button>
      </div>

      {saved && (
        <div className="alert alert-success">
          <CheckCircle size={15} /> Saved successfully
        </div>
      )}

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <Bot size={15} />
        <div>
          <strong>How it works:</strong> The AI uses these entries to answer customer questions accurately.
          Add your products, pricing, FAQs, policies, and business hours.
        </div>
      </div>

      {/* Search + category filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="conv-list-search" style={{ maxWidth: 280 }}>
          <Search size={14} />
          <input placeholder="Search entries..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className={`filter-chip ${!filterCat ? 'active' : ''}`} onClick={() => setFilterCat('')}>All</button>
        {categories.map(cat => (
          <button key={cat} className={`filter-chip ${filterCat === cat ? 'active' : ''}`} onClick={() => setFilterCat(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {/* Grid of entries */}
      {filtered.length === 0 ? (
        <div className="empty-state card" style={{ padding: 60 }}>
          <div className="empty-state-icon"><BookOpen size={24} color="var(--text-muted)" /></div>
          <h3>No entries yet</h3>
          <p>Add your products, pricing, and policies so the AI can answer customer questions accurately.</p>
          <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add First Entry</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtered.map(item => (
            <div key={item.id} className={`item-card ${!item.is_active ? 'opacity-50' : ''}`} style={{ opacity: item.is_active ? 1 : 0.5 }}>
              <div className="item-card-header">
                <div>
                  <div className="item-card-title">{item.title}</div>
                  {item.category && <span className="badge badge-ai" style={{ marginTop: 4 }}>{item.category}</span>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(item)} title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(item.id)} title="Delete">
                    <Trash2 size={13} color="var(--danger)" />
                  </button>
                </div>
              </div>
              <div className="item-card-content" style={{ maxHeight: 80, overflow: 'hidden' }}>
                {item.content}
              </div>
              <div className="item-card-footer">
                <label className="toggle">
                  <input type="checkbox" checked={item.is_active} onChange={() => toggle(item)} />
                  <span className="toggle-slider" />
                </label>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {item.is_active ? 'Active (AI uses this)' : 'Disabled'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">{editing ? 'Edit Entry' : 'New Knowledge Entry'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Basic Plan Pricing" />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. pricing, products, support, policies" />
              </div>
              <div className="form-group">
                <label className="form-label">Content (AI will use this to answer questions)</label>
                <textarea className="textarea" rows={6} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required placeholder="Describe your product, pricing, policies, FAQs..." />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Save'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
