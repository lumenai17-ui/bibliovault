import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Check, Loader2, ShieldCheck, BookOpen, Sparkles, Headphones, MessageSquare, Gift } from 'lucide-react';
import './SubscriptionPage.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
const PLAN_ID = 'P-7G896789MV201470PNIC2VZY';

declare global {
  interface Window {
    paypal?: any;
  }
}

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
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [error, setError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponSuccess, setCouponSuccess] = useState('');
  const paypalRef = useRef<HTMLDivElement>(null);
  const buttonsRendered = useRef(false);

  // Check current subscription status
  useEffect(() => {
    fetchStatus();
  }, []);

  // Render PayPal buttons once SDK is loaded and status is checked
  useEffect(() => {
    if (!loading && !status?.has_access && !buttonsRendered.current) {
      renderPayPalButtons();
    }
  }, [loading, status]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/subscription/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.has_access) onSubscribed();
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const renderPayPalButtons = () => {
    if (!window.paypal || !paypalRef.current || buttonsRendered.current) return;

    buttonsRendered.current = true;

    window.paypal.Buttons({
      style: {
        shape: 'pill',
        color: 'gold',
        layout: 'vertical',
        label: 'subscribe',
      },
      createSubscription: (_data: any, actions: any) => {
        return actions.subscription.create({
          plan_id: PLAN_ID,
          application_context: {
            shipping_preference: 'NO_SHIPPING',
          },
        });
      },
      onApprove: async (data: any) => {
        // Subscription approved — activate on our backend
        try {
          const res = await fetch(`${API_BASE}/subscription/activate-inline`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriptionId: data.subscriptionID,
              orderID: data.orderID,
            }),
          });

          if (res.ok) {
            onSubscribed();
          } else {
            const err = await res.json();
            setError(err.error || t('subscription.activateError'));
          }
        } catch {
          setError(t('subscription.activateConnectionError'));
        }
      },
      onError: (err: any) => {
        console.error('PayPal error:', err);
        setError(t('subscription.paypalError'));
      },
    }).render(paypalRef.current);
  };

  const handleCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setError('');
    setCouponSuccess('');
    try {
      const res = await fetch(`${API_BASE}/subscription/redeem-coupon`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCouponSuccess(data.message || t('subscription.couponSuccess'));
        setTimeout(() => onSubscribed(), 1500);
      } else {
        setError(data.error || t('subscription.couponInvalid'));
      }
    } catch {
      setError(t('subscription.connectionError'));
    } finally {
      setCouponLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="sub-page">
        <div className="sub-container">
          <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="sub-page">
      <div className="sub-container">
        <div className="sub-header">
          <Crown className="sub-crown" />
          <h1>Lectura Arcana</h1>
          <p className="sub-greeting">{t('subscription.welcome', { name: userName || userEmail.split('@')[0] })}</p>
          <p className="sub-tagline">{t('subscription.tagline')}</p>
        </div>

        <div className="sub-card">
          <div className="sub-price-tag">
            <span className="sub-trial">{t('subscription.trial')}</span>
            <div className="sub-price">
              <span className="sub-currency">$</span>
              <span className="sub-amount">12</span>
              <span className="sub-cents">.99</span>
              <span className="sub-period">{t('subscription.month')}</span>
            </div>
          </div>

          <ul className="sub-features">
            <li><BookOpen size={16} /> <span>{t('subscription.featureLibrary')}</span></li>
            <li><Sparkles size={16} /> <span>{t('subscription.featureAI')}</span></li>
            <li><MessageSquare size={16} /> <span>{t('subscription.featureChat')}</span></li>
            <li><Headphones size={16} /> <span>{t('subscription.featureAudio')}</span></li>
            <li><ShieldCheck size={16} /> <span>{t('subscription.featureAccess')}</span></li>
            <li><Check size={16} /> <span>{t('subscription.featureCancel')}</span></li>
          </ul>

          {error && <div className="sub-error">{error}</div>}
          {couponSuccess && <div className="sub-success">{couponSuccess}</div>}

          {/* PayPal Inline Buttons — tarjeta + PayPal */}
          <div className="sub-paypal-container">
            <div ref={paypalRef} id="paypal-button-container" />
          </div>

          {/* Coupon Section */}
          <div className="sub-coupon-section">
            <div className="sub-coupon-divider">
              <span>o</span>
            </div>
            <div className="sub-coupon-form">
              <Gift size={16} />
              <input
                type="text"
                placeholder={t('subscription.couponPlaceholder')}
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleCoupon()}
                maxLength={20}
              />
              <button onClick={handleCoupon} disabled={couponLoading || !couponCode.trim()}>
                {couponLoading ? <Loader2 size={14} className="spin" /> : t('subscription.apply')}
              </button>
            </div>
          </div>

          <p className="sub-disclaimer">
            {t('subscription.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
}
