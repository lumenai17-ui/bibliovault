import { useState, useEffect } from 'react';
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/admin/dashboard`, { credentials: 'include' })
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="admin-panel"><div className="admin-empty"><div className="empty-icon">⏳</div>Cargando dashboard...</div></div>;
  if (!data) return <div className="admin-panel"><div className="admin-empty"><div className="empty-icon">❌</div>Error al cargar datos</div></div>;

  const stats = [
    { icon: '👥', value: data.totalUsers, label: 'Usuarios', cls: 'users' },
    { icon: '📚', value: data.totalBooks.toLocaleString(), label: 'Libros', cls: 'books' },
    { icon: '💳', value: data.activeSubscriptions, label: 'Premium', cls: 'premium' },
    { icon: '⏳', value: data.pendingBooks, label: 'Pendientes', cls: 'pending' },
    { icon: '📤', value: data.totalUploads, label: 'Uploads', cls: 'uploads' },
    { icon: '💰', value: `$${data.estimatedRevenue.toFixed(2)}`, label: 'Ingresos Est.', cls: 'revenue' },
  ];

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>Panel de Administración</h2>
        <span className="admin-badge">ADMIN</span>
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
          <h4>👥 Últimos Usuarios</h4>
          {data.recentUsers.length === 0 && <div className="admin-empty">Sin usuarios recientes</div>}
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
          <h4>📤 Últimos Uploads</h4>
          {data.recentUploads.length === 0 && <div className="admin-empty">Sin uploads recientes</div>}
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
