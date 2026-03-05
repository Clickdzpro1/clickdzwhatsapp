const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (response.status === 401) {
      // Try refresh
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            this.setToken(data.token);
            headers['Authorization'] = `Bearer ${data.token}`;
            return fetch(`${API_BASE}${path}`, { ...options, headers });
          }
        } catch (e) {
          // Refresh failed
        }
      }
      this.setToken(null);
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    return response;
  }

  async get(path) {
    const res = await this.request(path);
    return res.json();
  }

  async post(path, body) {
    const res = await this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async patch(path, body) {
    const res = await this.request(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async del(path) {
    const res = await this.request(path, { method: 'DELETE' });
    return res.json();
  }
}

export const api = new ApiClient();
export default api;
