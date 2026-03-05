import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2 } from 'lucide-react';

export default function KnowledgeBasePage() {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', category: '' });

  const load = () => api.get('/knowledge-base').then(d => setItems(d.items || []));
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (editing) {
      await api.patch(`/knowledge-base/${editing}`, form);
    } else {
      await api.post('/knowledge-base', form);
    }
    setForm({ title: '', content: '', category: '' });
    setEditing(null);
    setShowForm(false);
    load();
  };

  const edit = (item) => {
    setForm({ title: item.title, content: item.content, category: item.category || '' });
    setEditing(item.id);
    setShowForm(true);
  };

  const remove = async (id) => {
    if (!confirm('Delete this item?')) return;
    await api.del(`/knowledge-base/${id}`);
    load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Knowledge Base</h2>
        <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ title: '', content: '', category: '' }); }}>
          <Plus size={16} /> Add Entry
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <form onSubmit={save}>
            <div className="form-group">
              <label>Title</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Pricing - Basic Plan" />
            </div>
            <div className="form-group">
              <label>Category</label>
              <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. pricing, products, support" />
            </div>
            <div className="form-group">
              <label>Content (the AI will use this to answer questions)</label>
              <textarea rows={4} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required placeholder="Describe your product, pricing, policies..." />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Add'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length === 0 ? (
          <div className="card empty-state" style={{ padding: 40 }}>
            <p>No knowledge base entries yet. Add your products, pricing, and policies so the AI can answer accurately.</p>
          </div>
        ) : items.map(item => (
          <div key={item.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h3 style={{ fontSize: 16, marginBottom: 4 }}>{item.title}</h3>
                {item.category && <span className="badge badge-ai" style={{ marginBottom: 8 }}>{item.category}</span>}
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8, whiteSpace: 'pre-wrap' }}>{item.content}</p>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => edit(item)}><Edit2 size={14} /></button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(item.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
