import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Send, Bot, UserCheck, ArrowLeftRight, Tag, StickyNote,
  Search, Filter, MoreVertical, Phone, X, ChevronDown,
  FileText, Sparkles, Users, AlertTriangle, Clock, CheckCheck
} from 'lucide-react';

const STATUS_COLORS = {
  open: 'badge-green',
  escalated: 'badge-red',
  waiting: 'badge-yellow',
  closed: 'badge-gray',
};

const PRIORITY_COLORS = {
  urgent: 'badge-red',
  high: 'badge-yellow',
  normal: 'badge-blue',
  low: 'badge-gray',
};

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(ts);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [filter, setFilter] = useState({ status: '', category: '', search: '' });
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [showDetails, setShowDetails] = useState(true);
  const messagesEndRef = useRef(null);

  const loadConversations = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.category) params.set('category', filter.category);
    if (filter.search) params.set('search', filter.search);
    api.get(`/conversations?${params}`).then(data => {
      setConversations(data.conversations || []);
    });
  }, [filter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useWebSocket(useCallback((data) => {
    if (data.type === 'new_message') {
      loadConversations();
      if (selected && data.senderJid === selected.whatsapp_jid) {
        loadMessages(selected.id);
      }
    }
  }, [selected, loadConversations]));

  const loadMessages = async (convId) => {
    const data = await api.get(`/conversations/${convId}/messages`);
    setMessages(data.messages || []);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const loadNotes = async (convId) => {
    const data = await api.get(`/conversations/${convId}/notes`);
    setNotes(data.notes || []);
  };

  const selectConversation = async (conv) => {
    setSelected(conv);
    setActiveTab('chat');
    await loadMessages(conv.id);
    await loadNotes(conv.id);
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selected || sending) return;
    setSending(true);
    try {
      await api.post(`/conversations/${selected.id}/reply`, { content: input });
      setInput('');
      await loadMessages(selected.id);
      loadConversations();
    } catch (err) {
      alert(err.message || 'Failed to send. Make sure WhatsApp is connected.');
    } finally {
      setSending(false);
    }
  };

  const addNote = async (e) => {
    e.preventDefault();
    if (!noteInput.trim() || !selected) return;
    await api.post(`/conversations/${selected.id}/notes`, { content: noteInput });
    setNoteInput('');
    await loadNotes(selected.id);
  };

  const toggleTakeover = async () => {
    if (!selected) return;
    if (selected.human_takeover) {
      await api.post(`/conversations/${selected.id}/handback`);
    } else {
      await api.patch(`/conversations/${selected.id}`, { humanTakeover: true, aiEnabled: false });
    }
    const updated = await api.get(`/conversations/${selected.id}`);
    setSelected(updated);
    loadConversations();
  };

  const summarize = async () => {
    const result = await api.post(`/conversations/${selected.id}/summarize`);
    const updated = await api.get(`/conversations/${selected.id}`);
    setSelected(updated);
    alert('Summary: ' + result.summary);
  };

  const updateField = async (field, value) => {
    const body = {};
    body[field] = value;
    await api.patch(`/conversations/${selected.id}`, body);
    const updated = await api.get(`/conversations/${selected.id}`);
    setSelected(updated);
    loadConversations();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply(e);
    }
  };

  return (
    <div className="conversations-layout" style={{ height: '100%' }}>
      {/* Left: Conv List */}
      <div className="conv-list-panel">
        <div className="conv-list-header">
          <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Conversations</h3>
          <div className="conv-list-search">
            <Search size={14} />
            <input
              placeholder="Search..."
              value={filter.search}
              onChange={e => setFilter({ ...filter, search: e.target.value })}
            />
          </div>
        </div>

        <div className="conv-filters">
          {[
            { value: '', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'escalated', label: 'Escalated' },
            { value: 'waiting', label: 'Waiting' },
            { value: 'closed', label: 'Closed' },
          ].map(f => (
            <button
              key={f.value}
              className={`filter-chip ${filter.status === f.value ? 'active' : ''}`}
              onClick={() => setFilter({ ...filter, status: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="conv-list">
          {conversations.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="empty-state-icon"><Users size={22} color="var(--text-muted)" /></div>
              <p>No conversations yet</p>
            </div>
          ) : conversations.map(conv => (
            <div
              key={conv.id}
              className={`conv-item ${selected?.id === conv.id ? 'active' : ''}`}
              onClick={() => selectConversation(conv)}
            >
              <div className="avatar" style={{ flexShrink: 0 }}>
                {(conv.contact_name || conv.push_name || '?')[0].toUpperCase()}
              </div>
              <div className="conv-item-info">
                <div className="conv-item-top">
                  <span className="conv-item-name">
                    {conv.contact_name || conv.push_name || conv.whatsapp_jid}
                  </span>
                  <span className="conv-item-time">{formatDate(conv.last_message_at)}</span>
                </div>
                <div className="conv-item-preview">
                  {conv.last_message_preview || 'No messages'}
                </div>
                <div className="conv-item-tags">
                  {conv.status && conv.status !== 'open' && (
                    <span className={`badge ${STATUS_COLORS[conv.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>
                      {conv.status}
                    </span>
                  )}
                  {conv.priority && conv.priority !== 'normal' && (
                    <span className={`badge ${PRIORITY_COLORS[conv.priority] || 'badge-gray'}`} style={{ fontSize: 10 }}>
                      {conv.priority}
                    </span>
                  )}
                  {conv.human_takeover && (
                    <span className="badge badge-yellow" style={{ fontSize: 10 }}>
                      <UserCheck size={9} /> Human
                    </span>
                  )}
                  {conv.category && conv.category !== 'uncategorized' && (
                    <span className="badge badge-ai" style={{ fontSize: 10, textTransform: 'capitalize' }}>
                      {conv.category}
                    </span>
                  )}
                </div>
              </div>
              {conv.unread_count > 0 && <div className="unread-dot" />}
            </div>
          ))}
        </div>
      </div>

      {/* Middle: Chat */}
      {selected ? (
        <div className="chat-panel">
          {/* Chat Header */}
          <div className="chat-header">
            <div className="avatar lg">
              {(selected.contact_name || selected.push_name || '?')[0].toUpperCase()}
            </div>
            <div className="chat-header-info">
              <div className="chat-header-name">
                {selected.contact_name || selected.push_name || selected.whatsapp_jid}
              </div>
              <div className="chat-header-meta">
                <span className={`status-dot ${selected.status === 'open' ? 'green' : selected.status === 'escalated' ? 'red' : 'gray'}`} />
                <span style={{ textTransform: 'capitalize' }}>{selected.status}</span>
                {selected.category && selected.category !== 'uncategorized' && (
                  <><span>·</span><span style={{ textTransform: 'capitalize' }}>{selected.category}</span></>
                )}
                {selected.priority && selected.priority !== 'normal' && (
                  <><span>·</span><span style={{ textTransform: 'capitalize', color: 'var(--warning)' }}>{selected.priority}</span></>
                )}
              </div>
            </div>
            <div className="chat-header-actions">
              <button
                className={`btn btn-sm ${selected.human_takeover ? 'btn-primary' : 'btn-secondary'}`}
                onClick={toggleTakeover}
                title={selected.human_takeover ? 'Hand back to AI' : 'Take over from AI'}
              >
                <ArrowLeftRight size={13} />
                {selected.human_takeover ? 'Resume AI' : 'Take Over'}
              </button>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={summarize} title="AI Summarize">
                <Sparkles size={14} />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setShowDetails(v => !v)}
                title="Toggle details"
              >
                <ChevronDown size={14} style={{ transform: showDetails ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
              </button>
            </div>
          </div>

          {/* Takeover bar */}
          {selected.human_takeover && (
            <div className="takeover-bar">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={14} /> You are in control — AI is paused for this conversation
              </span>
              <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--warning)', border: 'none' }} onClick={toggleTakeover}>
                Resume AI
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="empty-state">
                <p>No messages yet</p>
              </div>
            ) : messages.map(msg => {
              const isAi = msg.sender_type === 'ai';
              const isHuman = msg.sender_type === 'human';
              const isClient = msg.sender_type === 'client';
              return (
                <div key={msg.id} className={`message ${isClient ? 'inbound' : isAi ? 'ai' : 'outbound'}`}>
                  <div className="message-bubble">
                    {msg.content}
                  </div>
                  <div className="message-meta">
                    {isAi && <span className="message-sender-tag ai"><Bot size={10} /> AI</span>}
                    {isHuman && <span className="message-sender-tag human"><UserCheck size={10} /> You</span>}
                    <span>{formatTime(msg.created_at)}</span>
                    {isHuman && <CheckCheck size={12} color="var(--green)" />}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply bar */}
          <div className="chat-reply-bar">
            <div className="chat-reply-input">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selected.human_takeover ? 'Type a reply... (Enter to send)' : 'Take over to reply manually (click "Take Over" above)'}
                disabled={!selected.human_takeover || sending}
                rows={1}
              />
              <button
                className="btn btn-primary"
                style={{ padding: '10px 14px', flexShrink: 0 }}
                disabled={sending || !input.trim() || !selected.human_takeover}
                onClick={sendReply}
              >
                <Send size={16} />
              </button>
            </div>
            {!selected.human_takeover && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                AI is handling this conversation. Click <strong style={{ color: 'var(--text-secondary)' }}>"Take Over"</strong> to reply manually.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="chat-panel">
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state-icon">
              <Bot size={26} color="var(--text-muted)" />
            </div>
            <h3>Select a conversation</h3>
            <p>Choose a conversation from the list to view messages and manage AI settings.</p>
          </div>
        </div>
      )}

      {/* Right: Details panel */}
      {selected && showDetails && (
        <div className="chat-details">
          <div className="tabs" style={{ margin: '12px 16px 0', width: 'calc(100% - 32px)' }}>
            <button className={`tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Info</button>
            <button className={`tab ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>Notes</button>
          </div>

          {activeTab === 'chat' && (
            <>
              <div className="chat-detail-section">
                <div className="chat-detail-title">Contact</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.contact_name || selected.push_name || 'Unknown'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{selected.contact_phone || selected.whatsapp_jid}</div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selected.contact_tags?.map(t => (
                    <span key={t} className="badge badge-gray" style={{ fontSize: 10 }}>{t}</span>
                  ))}
                  {selected.client_type && (
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>{selected.client_type}</span>
                  )}
                </div>
              </div>

              <div className="chat-detail-section">
                <div className="chat-detail-title">Conversation</div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">Status</label>
                  <select className="select" value={selected.status} onChange={e => updateField('status', e.target.value)}>
                    <option value="open">Open</option>
                    <option value="waiting">Waiting</option>
                    <option value="escalated">Escalated</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">Priority</label>
                  <select className="select" value={selected.priority || 'normal'} onChange={e => updateField('priority', e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">Category</label>
                  <select className="select" value={selected.category || ''} onChange={e => updateField('category', e.target.value)}>
                    <option value="">Uncategorized</option>
                    <option value="support">Support</option>
                    <option value="sales">Sales</option>
                    <option value="complaint">Complaint</option>
                    <option value="inquiry">Inquiry</option>
                    <option value="billing">Billing</option>
                  </select>
                </div>
              </div>

              <div className="chat-detail-section">
                <div className="chat-detail-title">AI Control</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13 }}>AI Auto-reply</span>
                  <label className="toggle">
                    <input type="checkbox" checked={selected.ai_enabled && !selected.human_takeover} onChange={e => updateField('aiEnabled', e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Human takeover</span>
                  <label className="toggle">
                    <input type="checkbox" checked={selected.human_takeover} onChange={toggleTakeover} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                {selected.context_summary && (
                  <div style={{ marginTop: 12, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 4 }}>AI Summary</div>
                    {selected.context_summary}
                  </div>
                )}
              </div>

              <div className="chat-detail-section">
                <div className="chat-detail-title">Sentiment</div>
                <span className={`badge ${selected.sentiment === 'positive' ? 'badge-green' : selected.sentiment === 'negative' ? 'badge-red' : 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                  {selected.sentiment || 'neutral'}
                </span>
              </div>
            </>
          )}

          {activeTab === 'notes' && (
            <div className="chat-detail-section" style={{ flex: 1 }}>
              <div className="chat-detail-title">Internal Notes</div>
              <form onSubmit={addNote} style={{ marginBottom: 12 }}>
                <textarea
                  className="textarea"
                  placeholder="Add an internal note..."
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  rows={3}
                  style={{ marginBottom: 8 }}
                />
                <button type="submit" className="btn btn-secondary btn-sm w-full" style={{ justifyContent: 'center' }}>
                  <StickyNote size={13} /> Add Note
                </button>
              </form>
              {notes.map(note => (
                <div key={note.id} className="note-item">
                  {note.content}
                  <div className="note-item-time">{new Date(note.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
