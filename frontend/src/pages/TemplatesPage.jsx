import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2, Zap, X, Copy, CheckCircle } from 'lucide-react';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ shortcut: '', title: '', content: '', category: '' });
  const [copied, setCopied] = useState('');
  const [filterCat, setFilterCat] = useState('');

  const load = () => api.get('/templates').then(d => setTemplates(d.templates || []));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm({ shortcut: '', title: '', content: '', category: '' });
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (t) => {
    setForm({ shortcut: t.shortcut, title: t.title, content: t.content, category: t.category || '' });
    setEditing(t.id);
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.patch(`/templates/${editing}`, form);
      } else {
        await api.post('/templates', form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message || 'Failed to save');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this template?')) return;
    await api.del(`/templates/${id}`);
    load();
  };

  const copyContent = async (t) => {
    await api.post(`/templates/${t.id}/use`);
    navigator.clipboard.writeText(t.content).catch(() => {});
    setCopied(t.id);
    setTimeout(() => setCopied(''), 2000);
    load();
  };

  const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];
  const filtered = templates.filter(t => !filterCat || t.category === filterCat);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Reply Templates</h2>
          <p className="page-subtitle">Quick replies for common customer questions</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={15} /> Add Template
        </button>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <Zap size={15} />
        <div>
          <strong>Pro tip:</strong> Type the shortcut (e.g. <code style={{ background: 'rgba(59,130,246,0.2)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>/price</code>) in conversations to quickly use a template.
          The AI also uses high-usage templates as response examples.
        </div>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          <button className={`filter-chip ${!filterCat ? 'active' : ''}`} onClick={() => setFilterCat('')}>All</button>
          {categories.map(cat => (
            <button key={cat} className={`filter-chip ${filterCat === cat ? 'active' : ''}`} onClick={() => setFilterCat(cat)}>
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Templates grid */}
      {filtered.length === 0 ? (
        <div className="empty-state card" style={{ padding: 60 }}>
          <div className="empty-state-icon"><Zap size={24} color="var(--text-muted)" /></div>
          <h3>No templates yet</h3>
          <p>Create quick-reply templates for greetings, pricing questions, support responses, and more.</p>
          <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add First Template</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(t => (
            <div key={t.id} className="item-card">
              <div className="item-card-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <code style={{ background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 4, fontSize: 12, color: 'var(--green)', fontFamily: 'monospace' }}>
                      /{t.shortcut}
                    </code>
                    {t.usage_count > 0 && (
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>used {t.usage_count}×</span>
                    )}
                  </div>
                  <div className="item-card-title">{t.title}</div>
                  {t.category && <span className="badge badge-ai" style={{ marginTop: 4, fontSize: 10 }}>{t.category}</span>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(t)} title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(t.id)} title="Delete">
                    <Trash2 size={13} color="var(--danger)" />
                  </button>
                </div>
              </div>

              <div className="item-card-content"
                style={{ maxHeight: 72, overflow: 'hidden', borderLeft: '2px solid var(--border)', paddingLeft: 10, marginTop: 8 }}>
                {t.content}
              </div>

              <div className="item-card-footer">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyContent(t)}
                  style={{ marginLeft: 'auto' }}
                >
                  {copied === t.id ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                </button>
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
              <h3 className="modal-title">{editing ? 'Edit Template' : 'New Reply Template'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={save}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Shortcut</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--green)', fontWeight: 700 }}>/</span>
                    <input className="input" style={{ paddingLeft: 22 }} value={form.shortcut} onChange={e => setForm({ ...form, shortcut: e.target.value.replace(/^\//, '') })} required placeholder="price" />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Category</label>
                  <input className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. pricing, support" />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Template Title</label>
                <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Pricing Response" />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Message Content</label>
                <textarea className="textarea" rows={5} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required placeholder="The actual message text you want to send..." />
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
