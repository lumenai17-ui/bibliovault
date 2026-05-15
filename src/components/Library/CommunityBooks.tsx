import { useState, useEffect } from 'react';
import '../Admin/Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface CommunityBook {
  id: number;
  title: string;
  format: string;
  file_size: number;
  date_added: string;
  cover_path: string;
  category_id: number | null;
  category_name: string | null;
  uploader_name: string;
}

interface CommunityBooksProps {
  onReadBook?: (bookId: number) => void;
}

export default function CommunityBooks({ onReadBook }: CommunityBooksProps) {
  const [books, setBooks] = useState<CommunityBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/books/community`, { credentials: 'include' })
      .then(r => r.json())
      .then(setBooks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>🌐 Libros de la Comunidad</h2>
        <span className="admin-badge">{books.length} libros</span>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>Cargando...</div>
      ) : books.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-icon">🌐</div>
          Aún no hay libros compartidos por la comunidad.
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Formato</th>
                <th>Categoría</th>
                <th>Compartido por</th>
                <th>Tamaño</th>
                <th>Fecha</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {books.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.title}</td>
                  <td><span className={`badge badge-${b.format}`}>{b.format.toUpperCase()}</span></td>
                  <td style={{ fontSize: '12px', color: '#94a3b8' }}>{b.category_name || '—'}</td>
                  <td style={{ fontSize: '12px' }}>{b.uploader_name || 'Anónimo'}</td>
                  <td style={{ fontSize: '12px', color: '#94a3b8' }}>{formatSize(b.file_size)}</td>
                  <td style={{ fontSize: '12px', color: '#64748b' }}>{new Date(b.date_added).toLocaleDateString()}</td>
                  <td>
                    <button className="admin-btn" onClick={() => onReadBook?.(b.id)} title="Leer">📖 Leer</button>
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
