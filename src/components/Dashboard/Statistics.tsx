import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  fetchExtendedStats,
  type ExtendedStats,
  API_BASE,
} from '../../services/api';
import {
  Download,
  Database,
  Library,
  BookOpen,
  CheckCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import './Dashboard.css';

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Ahora mismo';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Hace ${diffDays} día${diffDays > 1 ? 's' : ''}`;
  return date.toLocaleDateString();
}

const PIE_COLORS = ['#667eea', '#a855f7', '#14b8a6', '#f59e0b', '#ef4444'];

export default function Statistics() {
  const [stats, setStats] = useState<ExtendedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchExtendedStats()
      .then(setStats)
      .catch((err) => {
        console.error('Failed to load stats:', err);
        setError(err.message || 'Error al cargar estadísticas');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <Loader2 className="spin" size={32} />
        <p>Cargando estadísticas...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>Dashboard & Estadísticas</h1>
        </div>
        <div className="dashboard-error" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: '18px', marginBottom: '8px' }}>⚠️ No se pudieron cargar las estadísticas</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{error || 'Intenta recargar la página'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard & Estadísticas</h1>
        <p>Visión general de tu colección en BiblioVault AI</p>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-kpis">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(102, 126, 234, 0.1)', color: '#667eea' }}>
            <Library size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.totalBooks.toLocaleString()}</span>
            <span className="kpi-label">Libros Totales</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            <BookOpen size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.totalPagesRead.toLocaleString()}</span>
            <span className="kpi-label">Páginas Leídas (Aprox)</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(20, 184, 166, 0.1)', color: '#14b8a6' }}>
            <CheckCircle size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.completedBooks.toLocaleString()}</span>
            <span className="kpi-label">Libros Completados</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
            <Clock size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">
              {stats.totalPages > 0 ? Math.round((stats.totalPagesRead / stats.totalPages) * 100) : 0}%
            </span>
            <span className="kpi-label">Progreso Global</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="dashboard-charts">
        <div className="chart-card">
          <h3>Distribución por Formato</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.formatStats}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {stats.formatStats.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: 'var(--text-primary)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3>Top Categorías</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.categoryStats}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
              >
                <XAxis type="number" stroke="var(--text-muted)" />
                <YAxis type="category" dataKey="name" stroke="var(--text-primary)" fontSize={12} width={100} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                />
                <Bar dataKey="value" fill="#667eea" radius={[0, 4, 4, 0]}>
                  {stats.categoryStats.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recently Read Section */}
      {stats.recentlyRead.length > 0 && (
        <div className="dashboard-recent">
          <h3 style={{ marginBottom: 16, fontSize: 16, color: 'var(--text-primary)' }}>📖 Lectura Reciente</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.recentlyRead.map((book, i) => {
              const pct = Math.round(book.progress * 100);
              const date = new Date(book.lastRead);
              const ago = getRelativeTime(date);
              return (
                <div key={i} style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  border: '1px solid var(--glass-border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {book.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{ago}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{
                      width: 80, height: 6, borderRadius: 3,
                      background: 'rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 3,
                        background: pct >= 99 ? '#14b8a6' : pct > 50 ? '#667eea' : '#a855f7',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: 'right',
                      color: pct >= 99 ? '#14b8a6' : '#94a3b8',
                    }}>
                      {pct >= 99 ? '✓' : `${pct}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tools Row */}
      <div className="dashboard-tools">
        <div className="tool-card">
          <div className="tool-info">
            <h3>Exportar a CSV</h3>
            <p>Descarga un archivo CSV con toda la metadata de tu colección para abrirlo en Excel o Notion.</p>
          </div>
          <a href={`${API_BASE}/export/csv`} download className="btn btn-primary">
            <Download size={16} /> Descargar CSV
          </a>
        </div>

        <div className="tool-card">
          <div className="tool-info">
            <h3>Backup Base de Datos</h3>
            <p>Descarga el archivo <code>bibliovault.db</code> que contiene tu progreso, chats, notas y marcas.</p>
          </div>
          <a href={`${API_BASE}/backup`} download className="btn btn-secondary">
            <Database size={16} /> Descargar .db
          </a>
        </div>
      </div>
    </div>
  );
}
