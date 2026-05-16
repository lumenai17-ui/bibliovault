import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../Admin/Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface UserBook {
  id: number;
  title: string;
  format: string;
  file_size: number;
  date_added: string;
  cover_path: string;
  visibility: string;
  category_id: number | null;
  category_name: string | null;
}

interface MyBooksProps {
  onReadBook?: (bookId: number) => void;
}

export default function MyBooks({ onReadBook }: MyBooksProps) {
  const { t } = useTranslation();
  const [books, setBooks] = useState<UserBook[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBooks = () => {
    setLoading(true);
    fetch(`${API}/api/books/my`, { credentials: 'include' })
      .then(r => r.json())
      .then(setBooks)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadBooks(); }, []);

  const shareBook = async (bookId: number) => {
    await fetch(`${API}/api/uploads/${bookId}/share`, {
      method: 'POST',
      credentials: 'include',
    });
    loadBooks();
  };

  const deleteBook = async (bookId: number) => {
    // Find the upload record to delete
    const uploads = await fetch(`${API}/api/uploads`, { credentials: 'include' }).then(r => r.json());
    const upload = uploads.find((u: any) => u.book_id === bookId);
    if (upload) {
      await fetch(`${API}/api/uploads/${upload.id}`, { method: 'DELETE', credentials: 'include' });
    }
    loadBooks();
  };

  const formatSize = (bytes: number) => {
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const visibilityBadge = (v: string) => {
    if (v === 'public') return <span className="badge badge-public">{t('myBooks.statusPublic')}</span>;
    if (v === 'pending') return <span className="badge badge-pending">{t('myBooks.statusPending')}</span>;
    return <span className="badge badge-private">{t('myBooks.statusPrivate')}</span>;
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>{t('myBooks.title')}</h2>
        <span className="admin-badge">
          {books.length === 1 
            ? t('myBooks.count_one', { count: 1 }) 
            : t('myBooks.count_other', { count: books.length })}
        </span>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>{t('myBooks.loading')}</div>
      ) : books.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-icon">📂</div>
          <span dangerouslySetInnerHTML={{ __html: t('myBooks.empty') }} />
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('myBooks.colTitle')}</th>
                <th>{t('myBooks.colFormat')}</th>
                <th>{t('myBooks.colSize')}</th>
                <th>{t('myBooks.colStatus')}</th>
                <th>{t('myBooks.colCategory')}</th>
                <th>{t('myBooks.colDate')}</th>
                <th>{t('myBooks.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {books.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.title}</td>
                  <td><span className={`badge badge-${b.format}`}>{b.format.toUpperCase()}</span></td>
                  <td style={{ fontSize: '12px', color: '#94a3b8' }}>{formatSize(b.file_size)}</td>
                  <td>{visibilityBadge(b.visibility)}</td>
                  <td style={{ fontSize: '12px', color: '#94a3b8' }}>{b.category_name || '—'}</td>
                  <td style={{ fontSize: '12px', color: '#64748b' }}>{new Date(b.date_added).toLocaleDateString()}</td>
                  <td>
                    <div className="admin-actions">
                      <button className="admin-btn" onClick={() => onReadBook?.(b.id)} title={t('myBooks.actionRead')}>📖</button>
                      {b.visibility === 'private' && (
                        <button className="admin-btn approve" onClick={() => shareBook(b.id)} title={t('myBooks.actionShare')}>📤</button>
                      )}
                      <button className="admin-btn reject" onClick={() => { if (confirm(t('myBooks.confirmDelete'))) deleteBook(b.id); }} title={t('myBooks.actionDelete')}>🗑️</button>
                    </div>
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
