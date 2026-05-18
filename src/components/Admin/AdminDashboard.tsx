import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface DashboardData {
  totalUsers: number;
  totalBooks: number;
  activeSubscriptions: number;
  pendingBooks: number;
  totalUploads: number;
  estimatedRevenue: number;
  recentUsers: Array<{ id: string; email: string; display_name: string; plan: string; created_at: string }>;
  recentUploads: Array<{ id: number; title: string; format: string; visibility: string; date_added: string; uploader_email: string }>;
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/admin/dashboard`, { credentials: 'include' })
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="admin-panel"><div className="admin-empty"><div className="empty-icon">⏳</div>{t('admin.loadingDashboard')}</div></div>;
  if (!data) return <div className="admin-panel"><div className="admin-empty"><div className="empty-icon">❌</div>{t('admin.errorData')}</div></div>;

  const stats = [
    { icon: '👥', value: data.totalUsers, label: t('admin.users'), cls: 'users' },
    { icon: '📚', value: data.totalBooks.toLocaleString(), label: t('admin.books'), cls: 'books' },
    { icon: '💳', value: data.activeSubscriptions, label: t('admin.premium'), cls: 'premium' },
    { icon: '⏳', value: data.pendingBooks, label: t('admin.pending'), cls: 'pending' },
    { icon: '📤', value: data.totalUploads, label: t('admin.uploads'), cls: 'uploads' },
    { icon: '💰', value: `$${data.estimatedRevenue.toFixed(2)}`, label: t('admin.revenue'), cls: 'revenue' },
  ];

  const handleSyncCovers = async () => {
    if (!confirm('¿Estás seguro de que deseas sincronizar todas las portadas locales con R2? Esto puede tardar varios minutos dependiendo de la cantidad.')) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API}/api/admin/sync-covers`, { method: 'POST', credentials: 'include' });
      const result = await res.json();
      if (res.ok) {
        alert(`¡Sincronización completada!\nPortadas subidas: ${result.synced}/${result.total}`);
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (err) {
      alert('Error de conexión');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>{t('admin.dashboardTitle')}</h2>
        <div>
          <button className="btn btn-secondary" onClick={handleSyncCovers} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Sincronizar Portadas a R2'}
          </button>
          <span className="admin-badge" style={{marginLeft: 10}}>ADMIN</span>
        </div>
      </div>

      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.cls} className={`admin-stat-card ${s.cls}`}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="admin-recent-list">
        <div className="admin-recent-card">
          <h4>👥 {t('admin.recentUsers')}</h4>
          {data.recentUsers.length === 0 && <div className="admin-empty">{t('admin.noRecentUsers')}</div>}
          {data.recentUsers.map(u => (
            <div key={u.id} className="admin-recent-item">
              <span>{u.display_name || u.email}</span>
              <span className="meta">
                <span className={`badge badge-${u.plan}`}>{u.plan}</span>
                {' '}{new Date(u.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>

        <div className="admin-recent-card">
          <h4>📤 {t('admin.recentUploads')}</h4>
          {data.recentUploads.length === 0 && <div className="admin-empty">{t('admin.noRecentUploads')}</div>}
          {data.recentUploads.map(b => (
            <div key={b.id} className="admin-recent-item">
              <span>{b.title}</span>
              <span className="meta">
                <span className={`badge badge-${b.visibility}`}>{b.visibility}</span>
                {' '}{b.uploader_email}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
