import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X, FileText, Trash2, CloudUpload } from 'lucide-react';
import './UploadPanel.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

interface UserUpload {
  id: string;
  book_id: number | null;
  original_filename: string;
  storage_path: string;
  file_size: number;
  uploaded_at: string;
  title?: string;
  visibility?: string;
}

interface UploadPanelProps {
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPanel({ onClose }: UploadPanelProps) {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadUploads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/uploads`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUploads(data);
      }
    } catch (err) {
      console.error('Failed to load uploads:', err);
    }
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  const handleUpload = async (file: File) => {
    setError('');
    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      const result = await new Promise<any>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || t('uploadPanel.uploadingError')));
            } catch {
              reject(new Error(t('uploadPanel.uploadingError')));
            }
          }
        };
        xhr.onerror = () => reject(new Error(t('uploadPanel.connectionError')));
        xhr.open('POST', `${API_BASE}/uploads`);
        xhr.withCredentials = true;
        xhr.send(formData);
      });

      loadUploads();
    } catch (err: any) {
      setError(err.message || t('uploadPanel.uploadingError'));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('uploadPanel.confirmDelete'))) return;
    
    try {
      const res = await fetch(`${API_BASE}/uploads/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setUploads(prev => prev.filter(u => u.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete upload:', err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = ''; // Reset for re-upload
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleShare = async (upload: UserUpload) => {
    if (!upload.book_id) return;
    try {
      const res = await fetch(`${API_BASE}/uploads/${upload.book_id}/share`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        loadUploads();
      }
    } catch (err) {
      console.error('Failed to share:', err);
    }
  };

  const getVisibilityBadge = (v?: string) => {
    if (v === 'public') return <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>✅ {t('myBooks.statusPublic', { defaultValue: 'Público' }).replace('✅ ', '')}</span>;
    if (v === 'pending') return <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(251,191,36,0.2)', color: '#fbbf24' }}>⏳ {t('myBooks.statusPending', { defaultValue: 'En revisión' }).replace('⏳ ', '')}</span>;
    return <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(100,116,139,0.2)', color: '#94a3b8' }}>🔒 {t('myBooks.statusPrivate', { defaultValue: 'Privado' }).replace('🔒 ', '')}</span>;
  };

  return (
    <>
      <div className="upload-panel-overlay" onClick={onClose} />
      <div className="upload-panel">
        <div className="upload-panel-header">
          <h2><CloudUpload size={20} /> {t('uploadPanel.title')}</h2>
          <button className="upload-panel-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-dropzone ${dragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload size={32} />
          <p>
            <span className="accent">{t('uploadPanel.dropHint1')}</span> {t('uploadPanel.dropHint2')}
          </p>
          <p className="upload-formats">{t('uploadPanel.formats')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,.doc,.docx"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Upload progress */}
        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="upload-progress-text">{progress}%</span>
          </div>
        )}

        {/* Error */}
        {error && <div className="upload-error">{error}</div>}

        {/* File list */}
        <div className="upload-list">
          <div className="upload-list-title">
            {t('uploadPanel.uploadedFiles')} ({uploads.length})
          </div>

          {uploads.length === 0 ? (
            <div className="upload-empty">
              {t('uploadPanel.empty')}
            </div>
          ) : (
            uploads.map((upload) => (
              <div key={upload.id} className="upload-item">
                <div className="upload-item-icon">
                  <FileText size={18} />
                </div>
                <div className="upload-item-info">
                  <div className="upload-item-name">{upload.title || upload.original_filename}</div>
                  <div className="upload-item-meta">
                    {formatFileSize(upload.file_size)} · {new Date(upload.uploaded_at).toLocaleDateString()}
                    {' '}{getVisibilityBadge(upload.visibility)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {upload.visibility === 'private' && upload.book_id && (
                    <button
                      className="upload-item-delete"
                      onClick={() => handleShare(upload)}
                      title={t('uploadPanel.share')}
                      style={{ color: '#60a5fa' }}
                    >
                      📤
                    </button>
                  )}
                  <button
                    className="upload-item-delete"
                    onClick={() => handleDelete(upload.id)}
                    title={t('uploadPanel.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
