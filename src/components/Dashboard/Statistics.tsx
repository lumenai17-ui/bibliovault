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
  Library,
  BookOpen,
  CheckCircle,
  Trophy,
  Flame,
  Loader2,
  BookMarked,
  Crown,
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

const PIE_COLORS = ['#667eea', '#a855f7', '#14b8a6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];
const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#cd7f32'];

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
          <p style={{ fontSize: '18px', marginBottom: '8px' }}>No se pudieron cargar las estadísticas</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{error || 'Intenta recargar la página'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard & Estadísticas</h1>
        <p>Tu actividad de lectura en BiblioVault AI</p>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-kpis">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(102, 126, 234, 0.1)', color: '#667eea' }}>
            <Library size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.totalBooks.toLocaleString()}</span>
            <span className="kpi-label">Libros en Biblioteca</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            <BookOpen size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.totalPagesRead.toLocaleString()}</span>
            <span className="kpi-label">Páginas Leídas</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(20, 184, 166, 0.1)', color: '#14b8a6' }}>
            <CheckCircle size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.completedBooks}</span>
            <span className="kpi-label">Libros Completados</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
            <Flame size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{stats.booksInProgress}</span>
            <span className="kpi-label">En Progreso</span>
          </div>
        </div>
      </div>

      {/* Charts Row — right after KPIs */}
      <div className="dashboard-charts">
        <div className="chart-card">
          <h3>Progreso de Lectura</h3>
          {stats.progressBreakdown.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-muted)', fontSize: 14 }}>
              Abre algunos libros para ver tu progreso
            </div>
          ) : (
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.progressBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {stats.progressBreakdown.map((entry, index) => {
                      const colorMap: Record<string, string> = {
                        'Completados': '#14b8a6',
                        'Avanzados': '#667eea',
                        'En Progreso': '#a855f7',
                        'Recién Empezados': '#f59e0b',
                      };
                      return <Cell key={`cell-${index}`} fill={colorMap[entry.name] || PIE_COLORS[index % PIE_COLORS.length]} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: 'var(--text-primary)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="chart-card">
          <h3>Tus Categorías Más Leídas</h3>
          {stats.categoryStats.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-muted)', fontSize: 14 }}>
              Lee algunos libros para ver tus categorías favoritas
            </div>
          ) : (
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
          )}
        </div>
      </div>

      {/* Second Row: Recently Read + Leaderboard (5 max, scrollable) */}
      <div className="dashboard-charts">
        {/* Recently Read */}
        <div className="chart-card" style={{ minHeight: 280 }}>
          <h3><BookMarked size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Lectura Reciente</h3>
          {stats.recentlyRead.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-muted)', fontSize: 14 }}>
              Aún no has abierto ningún libro
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
              {stats.recentlyRead.map((book, i) => {
                const pct = Math.round(book.progress * 100);
                const pagesRead = Math.round((book.pages || 0) * book.progress);
                const ago = getRelativeTime(new Date(book.lastRead));
                return (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: pct >= 99 ? 'rgba(20,184,166,0.15)' : 'rgba(102,126,234,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {pct >= 99
                        ? <CheckCircle size={14} color="#14b8a6" />
                        : <BookOpen size={14} color="#667eea" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {book.title}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
                        {ago} · {pagesRead}/{book.pages} págs · {book.format.toUpperCase()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <div style={{
                        width: 50, height: 4, borderRadius: 2,
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 2,
                          background: pct >= 99 ? '#14b8a6' : pct > 50 ? '#667eea' : '#a855f7',
                        }} />
                      </div>
                      <span style={{
                        fontSize: 10.5, fontWeight: 600, minWidth: 28, textAlign: 'right',
                        color: pct >= 99 ? '#14b8a6' : '#94a3b8',
                      }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="chart-card" style={{ minHeight: 280 }}>
          <h3><Trophy size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Ranking de Lectores</h3>
          {stats.leaderboard.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-muted)', fontSize: 14 }}>
              Nadie ha leído aún — sé el primero
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
              {stats.leaderboard.map((user, i) => (
                <div key={i} style={{
                  background: user.isCurrentUser ? 'rgba(102,126,234,0.1)' : 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: user.isCurrentUser ? '1px solid rgba(102,126,234,0.3)' : '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: i < 3 ? `rgba(${i === 0 ? '245,158,11' : i === 1 ? '148,163,184' : '205,127,50'},0.15)` : 'rgba(100,116,139,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {i < 3
                      ? <Crown size={14} color={MEDAL_COLORS[i]} />
                      : <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>#{i + 1}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: user.isCurrentUser ? 600 : 500,
                      fontSize: 12.5,
                      color: user.isCurrentUser ? '#818cf8' : 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {user.name} {user.isCurrentUser && '(tú)'}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
                      {user.booksRead} libro{user.booksRead !== 1 ? 's' : ''} leído{user.booksRead !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 13, fontWeight: 700,
                    color: i < 3 ? MEDAL_COLORS[i] : '#64748b',
                    flexShrink: 0,
                  }}>
                    {user.pagesRead.toLocaleString()}
                    <span style={{ fontSize: 9.5, fontWeight: 400, marginLeft: 2, opacity: 0.7 }}>págs</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Export Tool */}
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
      </div>
    </div>
  );
}
