import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, LayoutDashboard, Users, BookOpen, Settings, Smartphone, LogOut } from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/conversations', icon: MessageSquare, label: 'Conversations' },
  { path: '/contacts', icon: Users, label: 'Contacts' },
  { path: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base' },
  { path: '/whatsapp-setup', icon: Smartphone, label: 'WhatsApp' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div style={{ marginBottom: 16, color: 'white', fontWeight: 700, fontSize: 18 }}>C</div>
        {navItems.map(item => (
          <button
            key={item.path}
            className={`sidebar-btn ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            <item.icon size={22} />
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="sidebar-btn" onClick={logout} title="Logout">
          <LogOut size={22} />
        </button>
      </nav>
      <div className="main-content">
        {children}
      </div>
    </div>
  );
}
