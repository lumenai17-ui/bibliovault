import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User, CreditCard, Settings, Shield, Save, LogOut, Trash2,
  Check, AlertTriangle, Crown, Eye, EyeOff, Tag, Loader2,
} from 'lucide-react';
import {
  fetchProfile, updateProfile, updatePreferences, changePassword,
  getSubscriptionStatus, createSubscriptionApi, cancelSubscriptionApi,
  validateCouponApi, fetchPayments,
  type UserProfile, type SubscriptionStatus, type PaymentRecord,
} from '../../services/api';
import type { AuthUser } from '../Auth/AuthPage';
import './Settings.css';

type SettingsTab = 'profile' | 'membership' | 'preferences' | 'security';

interface SettingsPageProps {
  currentUser: AuthUser;
  onUserUpdate: (user: AuthUser) => void;
  onLogout: () => void;
}

export default function SettingsPage({ currentUser, onUserUpdate, onLogout }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>('profile');

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2><Settings size={22} /> Configuración</h2>
      </div>

      <div className="settings-tabs">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          <User size={14} /> Perfil
        </button>
        <button className={tab === 'membership' ? 'active' : ''} onClick={() => setTab('membership')}>
          <CreditCard size={14} /> Membresía
        </button>
        <button className={tab === 'preferences' ? 'active' : ''} onClick={() => setTab('preferences')}>
          <Settings size={14} /> Preferencias
        </button>
        <button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}>
          <Shield size={14} /> Seguridad
        </button>
      </div>

      <div className="settings-content">
        {tab === 'profile' && <ProfileTab currentUser={currentUser} onUserUpdate={onUserUpdate} />}
        {tab === 'membership' && <MembershipTab />}
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'security' && <SecurityTab onLogout={onLogout} />}
      </div>
    </div>
  );
}

// ── Profile Tab ──

function ProfileTab({ currentUser, onUserUpdate }: { currentUser: AuthUser; onUserUpdate: (u: AuthUser) => void }) {
  const [name, setName] = useState(currentUser.display_name);
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatar_url);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile().then(p => {
      setBio(p.bio || '');
      setAvatarUrl(p.avatar_url || '');
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ display_name: name, bio, avatar_url: avatarUrl });
      onUserUpdate({ ...currentUser, display_name: name, avatar_url: avatarUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div className="settings-section">
      <h3>Tu Perfil</h3>

      <div className="profile-avatar-section">
        <div className="profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="Avatar" /> : <User size={32} />}
        </div>
        <div className="profile-avatar-edit">
          <input
            type="text"
            placeholder="URL de tu avatar..."
            value={avatarUrl}
            onChange={e => setAvatarUrl(e.target.value)}
          />
          <span className="hint">Pega la URL de una imagen</span>
        </div>
      </div>

      <div className="form-group">
        <label>Nombre</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Email</label>
        <input type="text" value={currentUser.email} disabled className="disabled" />
      </div>

      <div className="form-group">
        <label>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="Cuéntanos sobre ti..." />
      </div>

      <div className="form-group">
        <label>Miembro desde</label>
        <input type="text" value={new Date(currentUser.created_at).toLocaleDateString('es')} disabled className="disabled" />
      </div>

      <button className="btn-save" onClick={handleSave} disabled={saving}>
        {saved ? <><Check size={14} /> Guardado</> : saving ? <><Loader2 size={14} className="spin" /> Guardando...</> : <><Save size={14} /> Guardar cambios</>}
      </button>
    </div>
  );
}

// ── Membership Tab ──

function MembershipTab() {
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [coupon, setCoupon] = useState('');
  const [couponResult, setCouponResult] = useState<{ valid: boolean; discount: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([getSubscriptionStatus(), fetchPayments()]);
      setSub(s);
      setPayments(p || []);
    } catch {}
    setLoading(false);
  };

  const handleValidateCoupon = async () => {
    if (!coupon.trim()) return;
    const result = await validateCouponApi(coupon);
    setCouponResult(result);
  };

  const handleSubscribe = async () => {
    setProcessing(true);
    try {
      const result = await createSubscriptionApi(couponResult?.valid ? coupon : undefined);
      window.location.href = result.approveUrl;
    } catch (err: any) {
      alert(err.message);
    }
    setProcessing(false);
  };

  const handleCancel = async () => {
    setProcessing(true);
    try {
      await cancelSubscriptionApi('Cancelado por el usuario');
      await loadData();
      setConfirmCancel(false);
    } catch (err: any) {
      alert(err.message);
    }
    setProcessing(false);
  };

  if (loading) return <div className="settings-loading">Cargando membresía...</div>;

  const isPremium = sub?.plan === 'premium';

  return (
    <div className="settings-section">
      <h3>Tu Membresía</h3>

      <div className={`plan-card ${isPremium ? 'premium' : 'free'}`}>
        <div className="plan-badge">
          {isPremium ? <><Crown size={16} /> Premium</> : '🆓 Free'}
        </div>
        <div className="plan-details">
          {isPremium ? (
            <>
              <p className="plan-price">$12.99/mes</p>
              {sub?.nextBilling && (
                <p className="plan-next">Próximo cobro: {new Date(sub.nextBilling).toLocaleDateString('es')}</p>
              )}
              {sub?.startDate && (
                <p className="plan-since">Miembro Premium desde: {new Date(sub.startDate).toLocaleDateString('es')}</p>
              )}
            </>
          ) : (
            <p className="plan-desc">Suscríbete para acceder a todas las funciones de Lectura Arcana.</p>
          )}
        </div>
      </div>

      {!isPremium && (
        <div className="subscribe-section">
          <div className="subscribe-features">
            <h4>Plan Premium — $12.99/mes</h4>
            <ul>
              <li><Check size={13} /> Biblioteca ilimitada</li>
              <li><Check size={13} /> Narración AI (Hermes)</li>
              <li><Check size={13} /> Foro & Comunidades</li>
              <li><Check size={13} /> Colecciones avanzadas</li>
              <li><Check size={13} /> Soporte prioritario</li>
            </ul>
          </div>

          <div className="coupon-section">
            <label><Tag size={12} /> ¿Tienes un cupón?</label>
            <div className="coupon-input">
              <input
                type="text"
                placeholder="Código de cupón"
                value={coupon}
                onChange={e => { setCoupon(e.target.value); setCouponResult(null); }}
              />
              <button onClick={handleValidateCoupon} disabled={!coupon.trim()}>Validar</button>
            </div>
            {couponResult && (
              <div className={`coupon-result ${couponResult.valid ? 'valid' : 'invalid'}`}>
                {couponResult.valid ? <Check size={12} /> : <AlertTriangle size={12} />}
                {couponResult.message}
              </div>
            )}
          </div>

          <button className="btn-subscribe" onClick={handleSubscribe} disabled={processing}>
            {processing ? <><Loader2 size={16} className="spin" /> Procesando...</> : '💳 Suscribirse con PayPal'}
          </button>
          <p className="subscribe-note">Cancela cuando quieras. Sin contratos.</p>
        </div>
      )}

      {isPremium && (
        <div className="cancel-section">
          {!confirmCancel ? (
            <button className="btn-cancel-sub" onClick={() => setConfirmCancel(true)}>
              Cancelar membresía
            </button>
          ) : (
            <div className="cancel-confirm">
              <p>¿Estás seguro? Perderás acceso a las funciones Premium.</p>
              <div className="cancel-buttons">
                <button className="btn-cancel-no" onClick={() => setConfirmCancel(false)}>No, mantener</button>
                <button className="btn-cancel-yes" onClick={handleCancel} disabled={processing}>
                  {processing ? 'Cancelando...' : 'Sí, cancelar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {payments.length > 0 && (
        <div className="payment-history">
          <h4>Historial de Pagos</h4>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Monto</th><th>Estado</th><th>Cupón</th></tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.created_at).toLocaleDateString('es')}</td>
                  <td>${p.amount} {p.currency}</td>
                  <td><span className={`status-${p.status}`}>{p.status}</span></td>
                  <td>{p.coupon_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Preferences Tab ──

function PreferencesTab() {
  const { t, i18n } = useTranslation();
  const [prefs, setPrefs] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile().then(p => setPrefs(p.preferences || {})).catch(() => {});
  }, []);

  const update = (key: string, value: any) => setPrefs(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    await updatePreferences(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  };

  return (
    <div className="settings-section">
      <h3>{t('settings.prefsTitle')}</h3>

      <div className="form-group">
        <label>{t('settings.interfaceLanguage')}</label>
        <select value={i18n.language.split('-')[0]} onChange={e => i18n.changeLanguage(e.target.value)}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="form-group">
        <label>{t('settings.readingLanguage')}</label>
        <select value={prefs.language || 'es'} onChange={e => update('language', e.target.value)}>
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="pt">Português</option>
          <option value="fr">Français</option>
        </select>
      </div>

      <div className="form-group">
        <label>Voz de narración preferida</label>
        <select value={prefs.voice || 'alloy'} onChange={e => update('voice', e.target.value)}>
          <option value="alloy">Alloy (Neutral)</option>
          <option value="echo">Echo (Masculina)</option>
          <option value="fable">Fable (Narrativa)</option>
          <option value="onyx">Onyx (Profunda)</option>
          <option value="nova">Nova (Femenina)</option>
          <option value="shimmer">Shimmer (Suave)</option>
        </select>
      </div>

      <div className="form-group">
        <label>Velocidad de narración</label>
        <select value={prefs.speed || '1.0'} onChange={e => update('speed', e.target.value)}>
          <option value="0.75">0.75x (Lenta)</option>
          <option value="1.0">1.0x (Normal)</option>
          <option value="1.25">1.25x (Rápida)</option>
          <option value="1.5">1.5x (Muy Rápida)</option>
        </select>
      </div>

      <button className="btn-save" onClick={handleSave} disabled={saving}>
        {saved ? <><Check size={14} /> Guardado</> : <><Save size={14} /> Guardar preferencias</>}
      </button>
    </div>
  );
}

// ── Security Tab ──

function SecurityTab({ onLogout }: { onLogout: () => void }) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setError('Las contraseñas no coinciden'); return; }
    if (newPw.length < 6) { setError('Mínimo 6 caracteres'); return; }

    setSaving(true);
    setError('');
    const result = await changePassword(currentPw, newPw);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => setSuccess(false), 3000);
    }
    setSaving(false);
  };

  return (
    <div className="settings-section">
      <h3>Seguridad</h3>

      <div className="security-block">
        <h4>Cambiar Contraseña</h4>
        {error && <div className="settings-error">{error}</div>}
        {success && <div className="settings-success"><Check size={14} /> Contraseña actualizada</div>}

        <div className="form-group">
          <label>Contraseña actual</label>
          <div className="password-input">
            <input type={showPw ? 'text' : 'password'} value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
            <button onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </div>

        <div className="form-group">
          <label>Nueva contraseña</label>
          <input type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Confirmar nueva contraseña</label>
          <input type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
        </div>

        <button className="btn-save" onClick={handleChangePassword} disabled={saving}>
          <Shield size={14} /> {saving ? 'Guardando...' : 'Cambiar contraseña'}
        </button>
      </div>

      <div className="security-block danger-zone">
        <h4>Sesión</h4>
        <button className="btn-logout" onClick={onLogout}>
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}
