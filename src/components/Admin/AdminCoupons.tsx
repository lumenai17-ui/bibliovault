import { useState, useEffect } from 'react';
import './Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface Coupon {
  code: string;
  days: number;
}

export default function AdminCoupons() {
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
        <h2>Cupones Activos</h2>
        <span className="admin-badge">{coupons.length} cupones</span>
      </div>

      <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
        Los cupones se configuran en <code style={{ color: '#c4b5fd', background: 'rgba(167,139,250,0.1)', padding: '2px 6px', borderRadius: '4px' }}>COUPON_CODES</code> en Render.
        <br />Formato: <code style={{ color: '#c4b5fd', background: 'rgba(167,139,250,0.1)', padding: '2px 6px', borderRadius: '4px' }}>CODIGO:DIAS,OTRO:DIAS</code>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>Cargando...</div>
      ) : coupons.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-icon">🎟️</div>
          No hay cupones configurados.<br />
          Agrega <code>COUPON_CODES</code> en las variables de entorno de Render.
        </div>
      ) : (
        <div className="coupon-grid">
          {coupons.map(c => (
            <div key={c.code} className="coupon-card">
              <div className="coupon-code">{c.code}</div>
              <div className="coupon-days">{c.days} días de Premium</div>
              <button className="coupon-copy" onClick={() => copyCode(c.code)}>
                {copied === c.code ? '✅ Copiado!' : '📋 Copiar código'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
