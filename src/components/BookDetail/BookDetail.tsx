import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Heart,
  X,
  Folder,
  HardDrive,
  FileText,
  Sparkles,
  Loader2,
  Search,
  ImageIcon,
  CheckCircle2,
  Pencil,
  Save,
  Bot,
  RefreshCw,
  Scan,
  FolderPlus,
  Plus,
  ShoppingCart,
  ExternalLink,
  MessageCircle,
  ArrowLeft,
} from 'lucide-react';
import type { Book, Collection } from '../../types';
import { BookDiscussion } from '../Community/BookDiscussion';
import {
  getBookCoverUrl,
  generateSummary,
  enrichBook as apiEnrichBook,
  extractPdfCover as apiExtractPdfCover,
  updateBook as apiUpdateBook,
  identifyTitle as apiIdentifyTitle,
  fetchBookCollections,
  addBookToCollection,
  removeBookFromCollection,
  createCollection,
} from '../../services/api';
import './BookDetail.css';

interface BookDetailProps {
  book: Book;
  collections?: Collection[];
  onClose: () => void;
  onRead: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  onUpdate?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function BookDetail({ book, collections = [], onClose, onRead, onToggleFavorite, onUpdate }: BookDetailProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<string>(book.aiSummary || '');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{
    found: boolean;
    source?: string;
    title?: string;
    author?: string;
  } | null>(null);
  const [extractingCover, setExtractingCover] = useState(false);
  const [coverKey, setCoverKey] = useState(0);
  const coverUrl = getBookCoverUrl(book.id, coverKey || undefined);

  // Collections state
  const [showCollectionsMenu, setShowCollectionsMenu] = useState(false);
  const [activeCollectionIds, setActiveCollectionIds] = useState<number[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Affiliate links
  interface AffiliateLink {
    id: number;
    platform: string;
    affiliate_url: string;
    price_estimate: number | null;
    currency: string;
  }
  const [affiliateLinks, setAffiliateLinks] = useState<AffiliateLink[]>([]);

  // Editable fields
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author || '');
  const [saving, setSaving] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [identifyResult, setIdentifyResult] = useState<{ title?: string; author?: string; confidence?: string } | null>(null);

  // Sync editable fields when book prop changes
  useEffect(() => {
    setEditTitle(book.title);
    setEditAuthor(book.author || '');
    setIdentifyResult(null);
    setEnrichResult(null);
    setCoverKey(Date.now()); // Force fresh cover on mount/update
    
    // Fetch active collections for this book
    fetchBookCollections(book.id).then(cols => {
      setActiveCollectionIds(cols.map(c => c.id));
    }).catch(console.error);

    // Fetch affiliate links
    fetch(`${import.meta.env.DEV ? 'http://localhost:3001' : ''}/api/books/${book.id}/affiliate-links`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setAffiliateLinks)
      .catch(() => setAffiliateLinks([]));
  }, [book.id, book.title, book.author]);

  const handleToggleCollection = async (collectionId: number) => {
    try {
      if (activeCollectionIds.includes(collectionId)) {
        await removeBookFromCollection(book.id, collectionId);
        setActiveCollectionIds(prev => prev.filter(id => id !== collectionId));
      } else {
        await addBookToCollection(book.id, collectionId);
        setActiveCollectionIds(prev => [...prev, collectionId]);
      }
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Failed to toggle collection', err);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim() || creatingCollection) return;
    setCreatingCollection(true);
    try {
      const col = await createCollection(newCollectionName.trim(), '', '#667eea');
      await addBookToCollection(book.id, col.id);
      setActiveCollectionIds(prev => [...prev, col.id]);
      setNewCollectionName('');
      if (onUpdate) onUpdate(); // this will trigger loadMeta in App.tsx and bring the new collection down via props
    } catch (err) {
      console.error('Failed to create collection', err);
    } finally {
      setCreatingCollection(false);
    }
  };

  // Manual refresh — ONLY called by user clicking refresh buttons
  const handleGenerateSummary = async (forceOcr = false) => {
    setSummaryLoading(true);
    try {
      const result = await generateSummary(book.id, { refresh: true, ocr: forceOcr });
      setSummary(result.summary);
    } catch {
      setSummary(t('bookDetail.errorSummary'));
    } finally {
      setSummaryLoading(false);
    }
  };

  // Auto-load summary — uses DB cache, only generates if no cached version exists
  useEffect(() => {
    if (!summary && book.format === 'pdf') {
      setSummaryLoading(true);
      generateSummary(book.id, { refresh: false })
        .then(result => setSummary(result.summary))
        .catch(() => setSummary(''))
        .finally(() => setSummaryLoading(false));
    }
  }, [book.id, book.format, summary]);

  const handleEnrich = async () => {
    setEnriching(true);
    try {
      const result = await apiEnrichBook(book.id);
      setEnrichResult(result);
      if (result.coverPath) {
        setCoverKey(Date.now());
      }
      // Update displayed title/author if found
      if (result.title) setEditTitle(result.title);
      if (result.author) setEditAuthor(result.author);
    } catch {
      setEnrichResult({ found: false });
    } finally {
      setEnriching(false);
      onUpdate?.();
    }
  };

  const handleExtractCover = async () => {
    setExtractingCover(true);
    try {
      const result = await apiExtractPdfCover(book.id);
      if (result.success) {
        setCoverKey(Date.now());
      }
    } catch {
      // Silent fail
    } finally {
      setExtractingCover(false);
      onUpdate?.();
    }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const newTitle = editTitle.trim();
      await apiUpdateBook(book.id, {
        title: newTitle,
        author: editAuthor.trim(),
      });
      
      // Si el título cambió, limpiar el resumen para forzar su regeneración
      if (newTitle !== book.title) {
        setSummary('');
      }

      setEditing(false);
      onUpdate?.(); // Refresh parent book list
    } catch {
      // Revert
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(enrichResult?.title || book.title);
    setEditAuthor(enrichResult?.author || book.author || '');
    setEditing(false);
  };

  const displayTitle = editing ? editTitle : (enrichResult?.title || editTitle);
  const displayAuthor = editing ? editAuthor : (enrichResult?.author || editAuthor || t('bookDetail.unknownAuthor'));

  return (
    <div className="book-detail-overlay" onClick={onClose}>
      <div className="book-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Mobile back bar */}
        <div className="book-detail-back-bar">
          <button className="book-detail-back-btn" onClick={onClose}>
            <ArrowLeft size={18} />
            <span>{t('reader.backToLibrary')}</span>
          </button>
        </div>
        {/* Header */}
        <div className="book-detail-header">
          <div className="book-detail-cover">
            <img src={coverUrl} alt={displayTitle} />
          </div>
          <div className="book-detail-meta">
            {/* Editable title & author */}
            {editing ? (
              <div className="book-detail-edit-fields">
                <input
                  className="book-detail-edit-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={t('bookDetail.editTitle')}
                />
                <input
                  className="book-detail-edit-input book-detail-edit-author"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  placeholder={t('bookDetail.editAuthor')}
                />
                <div className="book-detail-edit-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={saving}>
                    <Save size={12} /> {saving ? t('bookDetail.saving') : t('bookDetail.save')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>
                    {t('bookDetail.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="book-detail-title-row">
                  <div className="book-detail-title">{displayTitle}</div>
                  <button
                    className="btn-edit-title"
                    onClick={() => setEditing(true)}
                    title={t('bookDetail.tooltipEdit')}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
                <div className="book-detail-author">{displayAuthor}</div>
              </>
            )}

            <div className="book-detail-badges">
              <span className={`badge badge-${book.format}`}>
                {book.format.toUpperCase()}
              </span>
              {book.category && (
                <span className="badge" style={{ background: 'rgba(102,126,234,0.15)', color: 'var(--accent-primary)' }}>
                  {book.category}
                </span>
              )}
              {enrichResult?.source && (
                <span className="badge" style={{ background: 'rgba(72,187,120,0.15)', color: '#48bb78' }}>
                  {enrichResult.source === 'openlibrary' ? 'Open Library' : 'Google Books'} ✓
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
              <div className="book-detail-stat">
                <HardDrive /> {formatFileSize(book.fileSize)}
              </div>
              {book.pages > 0 && (
                <div className="book-detail-stat">
                  <FileText /> {book.pages} {t('bookDetail.pages')}
                </div>
              )}
              <div className="book-detail-stat">
                <Folder /> {book.category || t('bookDetail.uncategorized')}
              </div>
            </div>

            <div className="book-detail-actions" style={{ position: 'relative', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="btn-read" onClick={() => onRead(book)}>
                <BookOpen size={16} /> {t('bookDetail.read')}
              </button>
              <button
                className={`btn-fav ${book.favorite ? 'is-favorite' : ''}`}
                onClick={() => onToggleFavorite(book)}
              >
                <Heart size={14} fill={book.favorite ? 'currentColor' : 'none'} />
                {t('bookDetail.favorite')}
              </button>

              <div style={{ position: 'relative' }}>
                <button 
                  className={`btn-collections ${activeCollectionIds.length > 0 ? 'has-collections' : ''}`}
                  onClick={() => setShowCollectionsMenu(!showCollectionsMenu)}
                >
                  <FolderPlus size={14} />
                  {t('bookDetail.collections')} {activeCollectionIds.length > 0 && `(${activeCollectionIds.length})`}
                </button>

                {showCollectionsMenu && (
                  <div className="collections-popover animate-fade-in">
                    <div className="collections-popover-header">
                      <h4>{t('bookDetail.myCollections')}</h4>
                      <button className="btn-close-detail" style={{ width: 24, height: 24 }} onClick={() => setShowCollectionsMenu(false)}>
                        <X size={12} />
                      </button>
                    </div>
                    
                    <div className="collections-popover-list">
                      {collections.length === 0 ? (
                        <p className="collections-empty-text">{t('bookDetail.noCollections')}</p>
                      ) : (
                        collections.map(col => (
                          <label key={col.id} className="collection-checkbox">
                            <input 
                              type="checkbox" 
                              checked={activeCollectionIds.includes(col.id)}
                              onChange={() => handleToggleCollection(col.id)}
                            />
                            <span className="collection-name">{col.name}</span>
                          </label>
                        ))
                      )}
                    </div>

                    <form className="collection-create-form" onSubmit={handleCreateCollection}>
                      <input 
                        type="text" 
                        placeholder={t('bookDetail.newCollection')} 
                        value={newCollectionName}
                        onChange={e => setNewCollectionName(e.target.value)}
                        disabled={creatingCollection}
                      />
                      <button type="submit" disabled={!newCollectionName.trim() || creatingCollection} className="btn btn-icon btn-primary btn-sm">
                        {creatingCollection ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
                      </button>
                    </form>
                  </div>
                )}
              </div>

              <button className="btn-close-detail" onClick={onClose}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="book-detail-body">
          {/* Enrichment Actions */}
          <div className="book-detail-section">
            <h4><Search size={12} /> {t('bookDetail.searchInfo')}</h4>
            <div className="book-detail-enrich-actions">
              <button
                className={`btn-enrich enrich-api ${enrichResult?.found ? 'found' : ''}`}
                onClick={handleEnrich}
                disabled={enriching}
              >
                {enriching ? (
                  <><Loader2 size={12} className="spin" /> {t('bookDetail.searchingApi')}</>
                ) : enrichResult?.found ? (
                  <><CheckCircle2 size={12} /> {t('bookDetail.found')}</>
                ) : (
                  <><Sparkles size={12} /> {t('bookDetail.searchWebApi')}</>
                )}
              </button>

              {(book.format === 'pdf' || book.format === 'epub') && (
                <button
                  className="btn-enrich enrich-cover"
                  onClick={handleExtractCover}
                  disabled={extractingCover}
                >
                  {extractingCover ? (
                    <><Loader2 size={12} className="spin" /> {t('bookDetail.extracting')}</>
                  ) : (
                    <><ImageIcon size={12} /> {t('bookDetail.extractCover')}</>
                  )}
                </button>
              )}

              <button
                className={`btn-enrich enrich-ai ${identifyResult?.title ? 'identified' : ''}`}
                onClick={async () => {
                  setIdentifying(true);
                  try {
                    const result = await apiIdentifyTitle(book.id);
                    setIdentifyResult(result);
                    if (result.success && result.title) {
                      setEditTitle(result.title);
                      if (result.author) setEditAuthor(result.author);
                      setEditing(true);
                    }
                  } catch {
                    setIdentifyResult({ confidence: 'low' });
                  } finally {
                    setIdentifying(false);
                  }
                }}
                disabled={identifying}
              >
                {identifying ? (
                  <><Loader2 size={12} className="spin" /> {t('bookDetail.aiReading')}</>
                ) : identifyResult?.title ? (
                  <><CheckCircle2 size={12} /> AI: {identifyResult.confidence}</>
                ) : (
                  <><Bot size={12} /> {t('bookDetail.aiReadTitle')}</>
                )}
              </button>
            </div>

            {enrichResult && !enrichResult.found && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '8px' }}>
                {t('bookDetail.notFoundHint')}
              </div>
            )}

            {enrichResult?.found && enrichResult.title !== book.title && (
              <div style={{ fontSize: 'var(--fs-xs)', color: '#48bb78', marginTop: '8px' }}>
                {t('bookDetail.updatedHint')}
              </div>
            )}
          </div>

          {/* AI Summary */}
          <div className="book-detail-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0 }}><Sparkles size={12} /> {t('bookDetail.aiSummary')}</h4>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleGenerateSummary(false)}
                  disabled={summaryLoading}
                  title={t('bookDetail.regenNormal')}
                >
                  <RefreshCw size={12} className={summaryLoading ? 'spin' : ''} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleGenerateSummary(true)}
                  disabled={summaryLoading}
                  title={t('bookDetail.regenOcr')}
                >
                  <Scan size={12} /> OCR
                </button>
              </div>
            </div>
            
            {summaryLoading ? (
              <div className="book-detail-summary-loading">
                <Loader2 size={14} className="spin" /> {t('bookDetail.generatingSummary')}
              </div>
            ) : summary ? (
              <div className="book-detail-summary">{summary}</div>
            ) : (
              <div className="book-detail-summary" style={{ color: 'var(--text-muted)' }}>
                {t('bookDetail.noSummaryFormat')}
              </div>
            )}
          </div>

          {/* Affiliate / Buy Links */}
          <div className="book-detail-section">
            <h4><ShoppingCart size={12} /> {t('bookDetail.buyBook')}</h4>
            {affiliateLinks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {affiliateLinks.map(link => (
                  <a
                    key={link.id}
                    href={link.affiliate_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      fetch(`${import.meta.env.DEV ? 'http://localhost:3001' : ''}/api/affiliate/click/${link.id}`, {
                        method: 'POST', credentials: 'include'
                      });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 14px', background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)', textDecoration: 'none',
                      color: 'var(--text-primary)', transition: 'background 0.2s',
                      border: '1px solid var(--glass-border)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                  >
                    <ShoppingCart size={16} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ flex: 1 }}>{link.platform}</span>
                    {link.price_estimate && (
                      <span style={{ fontWeight: 600, color: 'var(--accent-secondary)' }}>
                        {link.currency === 'USD' ? '$' : link.currency}{link.price_estimate.toFixed(2)}
                      </span>
                    )}
                    <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />
                  </a>
                ))}
              </div>
            ) : (
              <a
                href={`https://www.amazon.com/s?k=${encodeURIComponent(book.title + ' ' + book.author)}&tag=bibliovault-20`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)', textDecoration: 'none',
                  color: 'var(--text-primary)', transition: 'background 0.2s',
                  border: '1px solid var(--glass-border)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
              >
                <ShoppingCart size={16} style={{ color: '#ff9900' }} />
                <span style={{ flex: 1 }}>{t('bookDetail.searchAmazon')}</span>
                <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />
              </a>
            )}
          </div>

          {/* Community Discussion */}
          <div className="book-detail-section">
            <h4><MessageCircle size={16} /> {t('bookDetail.communityDiscussion')}</h4>
            <BookDiscussion bookId={book.id} />
          </div>



        </div>
      </div>
    </div>
  );
}
