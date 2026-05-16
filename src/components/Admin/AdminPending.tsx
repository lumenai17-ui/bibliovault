import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface PendingBook {
  id: number;
  title: string;
  format: string;
  file_size: number;
  date_added: string;
  uploaded_by: string;
  uploader_email: string;
  uploader_name: string;
  category_id: number | null;
}

interface Category {
  id: number;
  name: string;
}

export default function AdminPending() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<PendingBook[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveState, setApproveState] = useState<Record<number, { categoryId: string; title: string }>>({});

  const loadPending = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/admin/books/pending`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/categories`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([b, cats]) => {
      setBooks(b);
      setCategories(cats);
      // Pre-fill approve state
      const state: Record<number, { categoryId: string; title: string }> = {};
      b.forEach((book: PendingBook) => {
        state[book.id] = { categoryId: book.category_id?.toString() || '', title: book.title };
      });
      setApproveState(state);
    }).catch(console.error)
    .finally(() => setLoading(false));
  };

  useEffect(() => { loadPending(); }, []);

  const handleApprove = async (bookId: number) => {
    const state = approveState[bookId];
    if (!state?.categoryId) {
      alert('Selecciona una categoría antes de aprobar.');
      return;
    }
    await fetch(`${API}/api/admin/uploads/${bookId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'approve',
        category_id: parseInt(state.categoryId),
        title: state.title,
      }),
    });
    loadPending();
  };

  const handleReject = async (bookId: number) => {
    if (!confirm('¿Rechazar este libro? Volverá a "Mis Libros" del usuario.')) return;
    await fetch(`${API}/api/admin/uploads/${bookId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'reject' }),
    });
    loadPending();
  };

  const formatSize = (bytes: number) => {
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>{t('admin.pendingBooks')}</h2>
        <span className="admin-badge">{t('admin.pendingCount', { count: books.length })}</span>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>{t('admin.loadingPending')}</div>
      ) : books.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-icon">✅</div>
          {t('admin.noPending')}
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('admin.colTitle')}</th>
                <th>{t('admin.colFormat')}</th>
                <th>{t('admin.colUploader')}</th>
                <th>{t('admin.colSize')}</th>
                <th>Status</th>
                <th>Date</th>
                <th>Category</th>
                <th>{t('admin.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {books.map(b => (
                <tr key={b.id}>
                  <td>
                    <input
                      value={approveState[b.id]?.title || b.title}
                      onChange={e => setApproveState(prev => ({
                        ...prev,
                        [b.id]: { ...prev[b.id], title: e.target.value },
                      }))}
                      style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '6px', padding: '4px 8px', color: '#e2e8f0', fontSize: '13px', width: '100%',
                      }}
                    />
                  </td>
                  <td><span className={`badge badge-${b.format}`}>{b.format.toUpperCase()}</span></td>
                  <td style={{ fontSize: '12px' }}>
                    <div>{b.uploader_name || '—'}</div>
                    <div style={{ color: '#64748b', fontSize: '11px' }}>{b.uploader_email}</div>
                  </td>
                  <td style={{ fontSize: '12px', color: '#94a3b8' }}>{formatSize(b.file_size)}</td>
                  <td>
                    <span className={`badge badge-${b.visibility || 'private'}`} style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                      background: b.visibility === 'pending' ? 'rgba(251,191,36,0.2)' : 'rgba(100,116,139,0.2)',
                      color: b.visibility === 'pending' ? '#fbbf24' : '#94a3b8',
                    }}>
                      {b.visibility === 'pending' ? `⏳ ${t('admin.pending')}` : '🔒 Private'}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: '#64748b' }}>{new Date(b.date_added).toLocaleDateString()}</td>
                  <td>
                    <select
                      className="admin-select"
                      value={approveState[b.id]?.categoryId || ''}
                      onChange={e => setApproveState(prev => ({
                        ...prev,
                        [b.id]: { ...prev[b.id], categoryId: e.target.value },
                      }))}
                      style={{ padding: '4px 8px', fontSize: '11px', maxWidth: '140px' }}
                    >
                      <option value="">— Seleccionar —</option>
                      <option value="">— {t('admin.selectCategory')} —</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="admin-actions">
                    <button className="btn-admin-action" onClick={() => handleApprove(b.id)} title={t('admin.actionApprove')}>
                      ✅
                    </button>
                    <button className="btn-admin-action btn-danger" onClick={() => handleReject(b.id)} title={t('admin.actionReject')}>
                      ❌
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
