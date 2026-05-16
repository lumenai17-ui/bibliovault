import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Library, Loader2 } from 'lucide-react';
import './AuthPage.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  plan: string;
  avatar_url: string;
  created_at: string;
  last_login: string | null;
  is_admin?: boolean;
}

interface AuthPageProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register' && password !== confirmPassword) {
      setError(t('auth.errorPasswordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, displayName: displayName || email.split('@')[0] };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t('auth.errorUnknown'));
        return;
      }

      onAuthSuccess(data.user);
    } catch (err) {
      setError(t('auth.errorConnection'));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Library />
          <h1>BiblioVault</h1>
        </div>
        <p className="auth-subtitle">
          {mode === 'login'
            ? t('auth.subtitleLogin')
            : t('auth.subtitleRegister')}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label>{t('auth.nameLabel')}</label>
              <input
                type="text"
                placeholder={t('auth.namePlaceholder')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-field">
            <label>{t('auth.emailLabel')}</label>
            <input
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label>{t('auth.passwordLabel')}</label>
            <input
              type="password"
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div className="auth-field">
              <label>{t('auth.confirmPasswordLabel')}</label>
              <input
                type="password"
                placeholder={t('auth.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? (
              <><Loader2 size={16} className="spin" /> {t('auth.processing')}</>
            ) : mode === 'login' ? (
              t('auth.loginButton')
            ) : (
              t('auth.registerButton')
            )}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>{t('auth.noAccount')} <button onClick={switchMode}>{t('auth.registerTab')}</button></>
          ) : (
            <>{t('auth.hasAccount')} <button onClick={switchMode}>{t('auth.loginTab')}</button></>
          )}
        </div>
      </div>
    </div>
  );
}
