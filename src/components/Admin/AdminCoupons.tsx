import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface Coupon {
  code: string;
  days: number;
}

export default function AdminCoupons() {
  const { t } = useTranslation();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/admin/coupons`, { credentials: 'include' })
      .then(r => r.json())
      .then(setCoupons)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>{t('admin.activeCoupons')}</h2>
        <span className="admin-badge">{t('admin.couponsCount', { count: coupons.length })}</span>
      </div>

      <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
        {t('admin.couponsDesc1')} <code style={{ color: '#c4b5fd', background: 'rgba(167,139,250,0.1)', padding: '2px 6px', borderRadius: '4px' }}>COUPON_CODES</code> {t('admin.couponsDesc2')}
        <br />{t('admin.couponsFormat')} <code style={{ color: '#c4b5fd', background: 'rgba(167,139,250,0.1)', padding: '2px 6px', borderRadius: '4px' }}>CODIGO:DIAS,OTRO:DIAS</code>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>{t('admin.loading')}</div>
      ) : coupons.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-icon">🎟️</div>
          {t('admin.noCoupons')}<br />
          {t('admin.addCouponsHint')}
        </div>
      ) : (
        <div className="coupon-grid">
          {coupons.map(c => (
            <div key={c.code} className="coupon-card">
              <div className="coupon-code">{c.code}</div>
              <div className="coupon-days">{t('admin.daysOfPremium', { days: c.days })}</div>
              <button className="coupon-copy" onClick={() => copyCode(c.code)}>
                {copied === c.code ? t('admin.copied') : t('admin.copyCode')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
