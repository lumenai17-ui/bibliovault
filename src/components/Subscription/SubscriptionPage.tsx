import { useState, useEffect } from 'react';
import { Crown, Check, Loader2, ShieldCheck, BookOpen, Sparkles, Headphones, MessageSquare } from 'lucide-react';
import './SubscriptionPage.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

interface SubscriptionPageProps {
  userEmail: string;
  userName: string;
  onSubscribed: () => void;
}

interface SubStatus {
  plan: string;
  subscription_status: string;
  has_access: boolean;
  days_remaining: number;
  subscription_end: string | null;
}

export default function SubscriptionPage({ userEmail, userName, onSubscribed }: SubscriptionPageProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [error, setError] = useState('');

  // Check if returning from PayPal
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscription') === 'success') {
      activateSubscription();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/subscription/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.has_access) onSubscribed();
      }
    } catch { /* ignore */ }
  };

  const activateSubscription = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/subscription/activate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        onSubscribed();
      } else {
        const data = await res.json();
        setError(data.error || 'Error activating subscription');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/subscription/create`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();

      if (data.status === 'already_active') {
        onSubscribed();
        return;
      }

      if (data.approvalUrl) {
        // Redirect to PayPal
        window.location.href = data.approvalUrl;
      } else {
        setError('No se pudo iniciar el pago');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sub-page">
      <div className="sub-container">
        <div className="sub-header">
          <Crown className="sub-crown" />
          <h1>Lectura Arcana</h1>
          <p className="sub-greeting">Bienvenido, {userName || userEmail.split('@')[0]}</p>
          <p className="sub-tagline">Tu biblioteca digital inteligente te espera</p>
        </div>

        <div className="sub-card">
          <div className="sub-price-tag">
            <span className="sub-trial">7 días gratis</span>
            <div className="sub-price">
              <span className="sub-currency">$</span>
              <span className="sub-amount">12</span>
              <span className="sub-cents">.99</span>
              <span className="sub-period">/mes</span>
            </div>
          </div>

          <ul className="sub-features">
            <li><BookOpen size={16} /> <span>Biblioteca completa — 1,400+ libros</span></li>
            <li><Sparkles size={16} /> <span>Hermes AI — Resúmenes y análisis inteligentes</span></li>
            <li><MessageSquare size={16} /> <span>Chat con AI sobre cualquier libro</span></li>
            <li><Headphones size={16} /> <span>Narración AI — Escucha tus libros</span></li>
            <li><ShieldCheck size={16} /> <span>Acceso ilimitado — Sin restricciones</span></li>
            <li><Check size={16} /> <span>Cancela cuando quieras</span></li>
          </ul>

          {error && <div className="sub-error">{error}</div>}

          <button
            className="sub-button"
            onClick={handleSubscribe}
            disabled={loading}
          >
            {loading ? (
              <><Loader2 size={18} className="spin" /> Procesando...</>
            ) : (
              <>Comenzar 7 Días Gratis</>
            )}
          </button>

          <p className="sub-disclaimer">
            Después del período de prueba se cobra $12.99 USD/mes.
            Puedes cancelar en cualquier momento.
          </p>
        </div>
      </div>
    </div>
  );
}
