import { useState } from 'react';
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
}

interface AuthPageProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
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
      setError('Las contraseñas no coinciden.');
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
        setError(data.error || 'Error desconocido.');
        return;
      }

      onAuthSuccess(data.user);
    } catch (err) {
      setError('No se pudo conectar con el servidor.');
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
            ? 'Inicia sesion para acceder a tu biblioteca'
            : 'Crea tu cuenta para empezar'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label>Nombre</label>
              <input
                type="text"
                placeholder="Tu nombre"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label>Contraseña</label>
            <input
              type="password"
              placeholder="Min. 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div className="auth-field">
              <label>Confirmar contraseña</label>
              <input
                type="password"
                placeholder="Repite tu contraseña"
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
              <><Loader2 size={16} className="spin" /> Procesando...</>
            ) : mode === 'login' ? (
              'Iniciar Sesion'
            ) : (
              'Crear Cuenta'
            )}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>No tienes cuenta? <button onClick={switchMode}>Registrate</button></>
          ) : (
            <>Ya tienes cuenta? <button onClick={switchMode}>Inicia sesion</button></>
          )}
        </div>
      </div>
    </div>
  );
}
