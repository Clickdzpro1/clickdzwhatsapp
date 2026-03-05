import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  MessageSquare, LayoutDashboard, Users, BookOpen,
  Settings, Smartphone, LogOut, Zap, FileText,
  CreditCard, Bot
} from 'lucide-react';

const navSections = [
  {
    label: 'Main',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/conversations', icon: MessageSquare, label: 'Conversations', badgeKey: 'unread' },
    ]
  },
  {
    label: 'AI & Content',
    items: [
      { path: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base' },
      { path: '/templates', icon: FileText, label: 'Reply Templates' },
    ]
  },
  {
    label: 'Management',
    items: [
      { path: '/contacts', icon: Users, label: 'Contacts' },
      { path: '/whatsapp-setup', icon: Smartphone, label: 'WhatsApp' },
      { path: '/billing', icon: CreditCard, label: 'Billing' },
      { path: '/settings', icon: Settings, label: 'Settings' },
    ]
  }
];

export default function Layout({ children, unreadCount = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <Bot size={20} color="white" />
          </div>
          <div>
            <div className="sidebar-brand-name">ClickDz</div>
            <div className="sidebar-brand-sub">WhatsApp AI</div>
          </div>
        </div>

        <div className="sidebar-nav">
          {navSections.map(section => (
            <React.Fragment key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.items.map(item => {
                const active = location.pathname === item.path ||
                  (item.path !== '/' && location.pathname.startsWith(item.path));
                const badge = item.badgeKey === 'unread' && unreadCount > 0 ? unreadCount : null;
                return (
                  <button
                    key={item.path}
                    className={`nav-item ${active ? 'active' : ''}`}
                    onClick={() => navigate(item.path)}
                  >
                    <item.icon size={17} />
                    <span>{item.label}</span>
                    {badge && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>

        <div className="sidebar-footer">
          {user?.plan === 'trial' && (
            <div style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              marginBottom: 8,
              fontSize: 11.5,
              color: 'var(--warning)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <Zap size={12} />
              Trial: ${parseFloat(user.trialBudgetRemaining || 0).toFixed(2)} left
            </div>
          )}
          <div className="sidebar-user" onClick={() => navigate('/settings')}>
            <div className="avatar">
              {(user?.name || 'U')[0].toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || 'User'}</div>
              <div className="sidebar-user-plan" style={{ textTransform: 'capitalize' }}>
                {user?.plan || 'trial'} plan
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); logout(); }}
              className="btn btn-ghost btn-icon"
              title="Logout"
              style={{ padding: 4 }}
            >
              <LogOut size={15} color="var(--text-muted)" />
            </button>
          </div>
        </div>
      </nav>

      <div className="main-content">
        {children}
      </div>
    </div>
  );
}
