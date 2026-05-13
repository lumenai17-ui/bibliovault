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

const PIE_COLORS = ['#667eea', '#a855f7', '#14b8a6', '#f59e0b', '#ef4444'];

export default function Statistics() {
  const [stats, setStats] = useState<ExtendedStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExtendedStats()
      .then(setStats)
      .catch((err) => console.error('Failed to load stats:', err))
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

  if (!stats) return <div className="dashboard-error">Error al cargar estadísticas</div>;

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
