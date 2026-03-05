import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.setToken(token);
      api.get('/auth/me')
        .then(data => {
          if (data.id) setUser(data);
          else {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
          }
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (credentials) => {
    const data = await api.post('/auth/login', credentials);
    if (data.token) {
      api.setToken(data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      setUser(data.tenant);
      return data;
    }
    throw new Error(data.error || 'Login failed');
  };

  const register = async (details) => {
    const data = await api.post('/auth/register', details);
    if (data.token) {
      api.setToken(data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      setUser(data.tenant);
      return data;
    }
    throw new Error(data.error || 'Registration failed');
  };

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken');
    api.post('/auth/logout', { refreshToken }).catch(() => {});
    api.setToken(null);
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
