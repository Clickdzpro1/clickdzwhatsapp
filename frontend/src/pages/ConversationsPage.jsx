import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { Send, Bot, UserCheck, ArrowLeftRight, Tag, StickyNote, AlertTriangle } from 'lucide-react';

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState({ status: '', category: '', search: '' });
  const [sending, setSending] = useState(false);
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

  // Real-time updates
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

  const selectConversation = async (conv) => {
    setSelected(conv);
    await loadMessages(conv.id);
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
      alert(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const toggleAI = async () => {
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

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return formatTime(ts);
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Conversation List */}
      <div className="conv-list">
        <div className="conv-list-header">
          <input
            className="search-input"
            placeholder="Search conversations..."
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {['', 'open', 'escalated', 'waiting', 'closed'].map(s => (
              <button
                key={s}
                className={`btn btn-sm ${filter.status === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter({ ...filter, status: s })}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="conv-list-items">
          {conversations.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>No conversations yet</div>
          ) : conversations.map(conv => (
            <div
              key={conv.id}
              className={`conv-item ${selected?.id === conv.id ? 'active' : ''}`}
              onClick={() => selectConversation(conv)}
            >
              <div className="avatar">
                {(conv.contact_name || conv.push_name || '?')[0].toUpperCase()}
              </div>
              <div className="info">
                <div className="name">{conv.contact_name || conv.push_name || conv.whatsapp_jid}</div>
                <div className="preview">{conv.last_message_preview || 'No messages'}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {conv.priority === 'urgent' && <span className="badge badge-urgent">Urgent</span>}
                  {conv.priority === 'high' && <span className="badge badge-high">High</span>}
                  {conv.category && conv.category !== 'uncategorized' && (
                    <span className="badge badge-ai" style={{ textTransform: 'capitalize' }}>{conv.category}</span>
                  )}
                  {conv.client_type === 'new' && <span className="badge badge-new">New</span>}
                </div>
              </div>
              <div className="meta">
                <span>{formatDate(conv.last_message_at)}</span>
                {conv.unread_count > 0 && <span className="badge-unread">{conv.unread_count}</span>}
                {conv.human_takeover && <span title="Human mode" style={{ fontSize: 14 }}><UserCheck size={14} /></span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Panel */}
      {selected ? (
        <div className="chat-panel">
          <div className="chat-header">
            <div className="avatar" style={{ width: 40, height: 40, fontSize: 16 }}>
              {(selected.contact_name || selected.push_name || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{selected.contact_name || selected.push_name || selected.whatsapp_jid}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {selected.category} &bull; {selected.sentiment} &bull; {selected.priority} priority
              </div>
            </div>
            <button
              className={`btn btn-sm ${selected.human_takeover ? 'btn-primary' : 'btn-secondary'}`}
              onClick={toggleAI}
              title={selected.human_takeover ? 'Hand back to AI' : 'Take over from AI'}
            >
              <ArrowLeftRight size={14} />
              {selected.human_takeover ? 'Resume AI' : 'Take Over'}
            </button>
          </div>

          <div className="chat-messages">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`message-bubble ${msg.sender_type === 'client' ? 'incoming' : msg.sender_type === 'ai' ? 'ai' : 'outgoing'}`}
              >
                {msg.sender_type === 'ai' && <div className="ai-tag"><Bot size={12} /> AI</div>}
                <div>{msg.content}</div>
                <div className="time">{formatTime(msg.created_at)}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input" onSubmit={sendReply}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={selected.human_takeover ? 'Type a reply...' : 'Take over to reply manually...'}
              disabled={sending}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      ) : (
        <div className="chat-panel empty-state">
          <MessageSquare size={48} style={{ color: 'var(--border)' }} />
          <p>Select a conversation to start</p>
        </div>
      )}
    </div>
  );
}

function MessageSquare(props) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>;
}
