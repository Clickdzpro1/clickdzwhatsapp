import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bot, ArrowRight, CheckCircle } from 'lucide-react';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', businessName: '', businessType: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/whatsapp-setup');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Bot size={28} color="white" />
          </div>
          <h1>Create your account</h1>
          <p>$5 free trial — no credit card required</p>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {['AI Auto-replies', '5$ Free Trial', 'Cancel anytime'].map(t => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--green)' }}>
              <CheckCircle size={12} /> {t}
            </div>
          ))}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Your Name</label>
              <input className="input" value={form.name} onChange={update('name')} required placeholder="Ahmed" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Phone</label>
              <input className="input" value={form.phone} onChange={update('phone')} placeholder="+213 XXX" />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Email</label>
            <input className="input" type="email" value={form.email} onChange={update('email')} required placeholder="you@example.com" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Business Name</label>
              <input className="input" value={form.businessName} onChange={update('businessName')} placeholder="Your Shop" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Type</label>
              <select className="select" value={form.businessType} onChange={update('businessType')}>
                <option value="">Select type</option>
                <option value="ecommerce">E-commerce</option>
                <option value="restaurant">Restaurant</option>
                <option value="services">Services</option>
                <option value="retail">Retail</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 12, marginBottom: 20 }}>
            <label className="form-label">Password</label>
            <input className="input" type="password" value={form.password} onChange={update('password')} required minLength={6} placeholder="Min 6 characters" />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <span className="loading-spinner" style={{ width: 18, height: 18 }} /> : <>Start Free Trial <ArrowRight size={16} /></>}
          </button>
        </form>

        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--green)', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
