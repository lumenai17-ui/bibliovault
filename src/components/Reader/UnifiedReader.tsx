import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Moon,
  Sun,
  Maximize,
  Bot,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Columns2,
  Bookmark,
  BookmarkCheck,
  List,
  Palette,
  X,
  Search,
  Plus,
  Volume2,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import PdfReader, { type PageLayout } from './PdfReader';
import ImageViewer from './ImageViewer';
import HtmlReader from './HtmlReader';
import AiChatPanel from './AiChatPanel';
import TtsControls from './TtsControls';
import type { Book } from '../../types';
import type { AiAction } from '../../services/ai';
import type { Bookmark as BookmarkType } from '../../services/api';
import { getBookFileUrl, updateBook, fetchBookText, fetchBookmarks, addBookmark, removeBookmark, searchInBook as apiSearchInBook, saveReadingProgress, getReadingProgress } from '../../services/api';
import './Reader.css';

type ReaderTheme = 'default' | 'night' | 'sepia' | 'paper';

interface UnifiedReaderProps {
  book: Book;
  onClose: () => void;
  onNavigate?: (action: AiAction) => void;
}

const THEME_CONFIG: Record<ReaderTheme, { label: string; icon: string; filterCSS: string; bgClass: string }> = {
  default: { label: 'Normal', icon: '☀️', filterCSS: '', bgClass: '' },
  night: { label: 'Noche', icon: '🌙', filterCSS: 'invert(0.88) hue-rotate(180deg)', bgClass: 'reader-night' },
  sepia: { label: 'Sepia', icon: '📜', filterCSS: 'sepia(0.35) brightness(0.95) contrast(1.05)', bgClass: 'reader-sepia' },
  paper: { label: 'Papel', icon: '📄', filterCSS: 'brightness(1.1) contrast(0.95)', bgClass: 'reader-paper' },
};

export default function UnifiedReader({ book, onClose, onNavigate }: UnifiedReaderProps) {
  const savedProgressRef = useRef(book.readingProgress || 0);
  const hasRestoredRef = useRef(false);

  const savedPage = book.readingProgress > 0 && book.pages > 0
    ? Math.max(1, Math.round(book.readingProgress * book.pages))
    : 1;

  const [currentPage, setCurrentPage] = useState(savedPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [theme, setTheme] = useState<ReaderTheme>('default');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [pageInput, setPageInput] = useState(String(savedPage));
  const [pageLayout, setPageLayout] = useState<PageLayout>('single');
  const [pageText, setPageText] = useState('');
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ page: number; snippet: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(savedPage);
  const totalPagesRef = useRef(0);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mobileSubView, setMobileSubView] = useState<'none' | 'themes' | 'bookmarks'>('none');

  const fileUrl = getBookFileUrl(book.id);

  // Load bookmarks
  useEffect(() => {
    fetchBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  // Extract real text from current page for TTS narration
  useEffect(() => {
    if (book.format === 'image') {
      setPageText('');
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const endPage = pageLayout === 'double' ? currentPage + 1 : currentPage;
        const result = await fetchBookText(book.id, currentPage, endPage);
        const text = result.fullText?.trim() || '';
        setPageText(text.length > 30 ? text : '');
      } catch {
        setPageText('');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [book.id, book.format, currentPage, pageLayout]);

  // Load per-user reading progress on mount
  useEffect(() => {
    getReadingProgress(book.id).then((data) => {
      if (data.progress > 0 && book.pages > 0 && !hasRestoredRef.current) {
        const page = Math.max(1, Math.round(data.progress * book.pages));
        savedProgressRef.current = data.progress;
        setCurrentPage(page);
        setPageInput(String(page));
        currentPageRef.current = page;
      }
    }).catch(() => {});
  }, [book.id, book.pages]);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);

  const saveProgress = useCallback((page: number, total: number) => {
    if (total <= 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const progress = Math.min(1, Math.max(0, page / total));
      saveReadingProgress(book.id, progress, page);
    }, 1500);
  }, [book.id]);

  useEffect(() => {
    if (totalPages > 0) saveProgress(currentPage, totalPages);
  }, [currentPage, totalPages, saveProgress]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const cp = currentPageRef.current;
      const tp = totalPagesRef.current;
      if (tp > 0) {
        saveReadingProgress(book.id, Math.min(1, Math.max(0, cp / tp)), cp);
      }
    };
  }, [book.id]);

  const pageStep = pageLayout === 'double' ? 2 : 1;

  const handlePrevPage = useCallback(() => {
    setCurrentPage((p) => {
      const next = Math.max(1, p - pageStep);
      setPageInput(String(next));
      return next;
    });
  }, [pageStep]);

  const handleNextPage = useCallback(() => {
    setCurrentPage((p) => {
      const next = Math.min(totalPages, p + pageStep);
      setPageInput(String(next));
      return next;
    });
  }, [totalPages, pageStep]);

  const handlePageInput = (value: string) => {
    setPageInput(value);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      setCurrentPage(num);
    }
  };

  const handleZoomIn = () => setScale((s) => Math.min(3, s + 0.2));
  const handleZoomOut = () => setScale((s) => Math.max(0.4, s - 0.2));

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const handleClose = useCallback(() => {
    setIsClosing(true);
    // Save before closing
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (totalPagesRef.current > 0) {
      const cp = currentPageRef.current;
      const tp = totalPagesRef.current;
      saveReadingProgress(book.id, Math.min(1, Math.max(0, cp / tp)), cp);
    }
    // Animate out, then close
    setTimeout(onClose, 250);
  }, [book.id, onClose]);

  const togglePageLayout = () => {
    setPageLayout((l) => l === 'single' ? 'double' : 'single');
  };

  // Bookmark toggle for current page
  const isCurrentPageBookmarked = bookmarks.some(b => b.page === currentPage);

  const handleToggleBookmark = async () => {
    if (isCurrentPageBookmarked) {
      const bm = bookmarks.find(b => b.page === currentPage);
      if (bm) {
        await removeBookmark(book.id, bm.id);
        setBookmarks(prev => prev.filter(b => b.id !== bm.id));
      }
    } else {
      try {
        const bm = await addBookmark(book.id, currentPage);
        setBookmarks(prev => [...prev, bm].sort((a, b) => a.page - b.page));
      } catch {
        // Already exists
      }
    }
  };

  const handleGoToBookmark = (page: number) => {
    setCurrentPage(page);
    setPageInput(String(page));
    setShowBookmarks(false);
  };

  // Cycle through themes
  const cycleTheme = () => {
    const themes: ReaderTheme[] = ['default', 'night', 'sepia', 'paper'];
    const idx = themes.indexOf(theme);
    setTheme(themes[(idx + 1) % themes.length]);
    setShowThemePicker(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevPage();
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        handleNextPage();
      }
      if (e.key === 'Escape') {
        if (showSearch) { setShowSearch(false); return; }
        handleClose();
      }
      if (e.key === 'b' || e.key === 'B') handleToggleBookmark();
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlePrevPage, handleNextPage, handleClose, isCurrentPageBookmarked, bookmarks, book.id, currentPage, showSearch]);

  const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const nightMode = theme === 'night';
  const themeConfig = THEME_CONFIG[theme];

  const renderViewer = () => {
    const imageFormats = ['image', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg'];
    if (imageFormats.includes(book.format) || /\.(jpe?g|png|gif|webp|bmp|tiff?|svg)$/i.test(fileUrl)) {
      return <ImageViewer fileUrl={fileUrl} nightMode={nightMode} />;
    }

    if (book.format === 'doc' || book.format === 'docx' || fileUrl.endsWith('.doc') || fileUrl.endsWith('.docx')) {
      return <HtmlReader bookId={book.id} scale={scale} nightMode={nightMode} />;
    }

    return (
      <PdfReader
        fileUrl={fileUrl}
        scale={scale}
        currentPage={currentPage}
        onPageChange={(p) => {
          setCurrentPage(p);
          setPageInput(String(p));
        }}
        onTotalPages={(t) => {
          setTotalPages(t);
          if (!hasRestoredRef.current && savedProgressRef.current > 0 && t > 0) {
            hasRestoredRef.current = true;
            const restoredPage = Math.max(1, Math.min(t, Math.round(savedProgressRef.current * t)));
            setCurrentPage(restoredPage);
            setPageInput(String(restoredPage));
            currentPageRef.current = restoredPage;
          }
        }}
        nightMode={nightMode}
        pageLayout={pageLayout}
      />
    );
  };

  return (
    <div
      className={`reader-overlay ${themeConfig.bgClass} ${isClosing ? 'reader-closing' : ''}`}
    >
      {/* Toolbar */}
      <div className="reader-toolbar">
        <button className="reader-toolbar-back" onClick={handleClose}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className="reader-toolbar-title">
          {book.title}
          {book.author && <span>— {book.author}</span>}
        </div>

        {/* Mobile page indicator (visible only <768px via CSS) */}
        <div className="reader-mobile-page">
          <input
            type="text"
            value={pageInput}
            onChange={(e) => handlePageInput(e.target.value)}
          />
          <span>/ {totalPages || '—'}</span>
        </div>

        <div className="reader-toolbar-actions">
          {/* Group 1: Layout */}
          {book.format !== 'image' && (
            <div className="reader-toolbar-group">
              <button
                className={`btn-icon ${pageLayout === 'single' ? 'active' : ''}`}
                onClick={() => setPageLayout('single')}
                title="Una página"
              >
                <BookOpen size={14} />
              </button>
              <button
                className={`btn-icon ${pageLayout === 'double' ? 'active' : ''}`}
                onClick={() => setPageLayout('double')}
                title="Dos páginas"
              >
                <Columns2 size={14} />
              </button>
            </div>
          )}

          {/* Group 2: Zoom */}
          <div className="reader-toolbar-group">
            <button className="btn-icon" onClick={handleZoomOut} title="Alejar">
              <ZoomOut size={14} />
            </button>
            <span style={{ minWidth: 38, textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(scale * 100)}%
            </span>
            <button className="btn-icon" onClick={handleZoomIn} title="Acercar">
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Group 3: Tools */}
          <div className="reader-toolbar-group">
            {/* Theme */}
            <div style={{ position: 'relative' }}>
              <button
                className={`btn-icon ${showThemePicker ? 'active' : ''}`}
                onClick={() => setShowThemePicker(!showThemePicker)}
                title={`Tema: ${themeConfig.label}`}
              >
                <Palette size={14} />
              </button>
              {showThemePicker && (
                <div className="reader-theme-picker">
                  {(Object.keys(THEME_CONFIG) as ReaderTheme[]).map((t) => (
                    <button
                      key={t}
                      className={`reader-theme-option ${t === theme ? 'active' : ''}`}
                      onClick={() => { setTheme(t); setShowThemePicker(false); }}
                    >
                      <span>{THEME_CONFIG[t].icon}</span>
                      <span>{THEME_CONFIG[t].label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bookmark toggle */}
            <button
              className={`btn-icon ${isCurrentPageBookmarked ? 'reader-bookmarked' : ''}`}
              onClick={handleToggleBookmark}
              title={isCurrentPageBookmarked ? 'Quitar marcador' : 'Agregar marcador (B)'}
            >
              {isCurrentPageBookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            </button>

            {/* Bookmark list */}
            <div style={{ position: 'relative' }}>
              <button
                className={`btn-icon ${showBookmarks ? 'active' : ''}`}
                onClick={() => setShowBookmarks(!showBookmarks)}
                title={`Marcadores (${bookmarks.length})`}
              >
                <List size={14} />
                {bookmarks.length > 0 && <span className="reader-bookmark-count">{bookmarks.length}</span>}
              </button>

              {showBookmarks && (
                <div className="reader-bookmarks-panel">
                  <div className="reader-bookmarks-header">
                    <h4>📑 Marcadores</h4>
                    <button className="btn-icon" onClick={() => setShowBookmarks(false)}>
                      <X size={12} />
                    </button>
                  </div>
                  {bookmarks.length === 0 ? (
                    <div className="reader-bookmarks-empty">
                      <Bookmark size={24} />
                      <p>Sin marcadores aún.<br />Presiona <strong>B</strong> para marcar una página.</p>
                    </div>
                  ) : (
                    <div className="reader-bookmarks-list">
                      {bookmarks.map((bm) => (
                        <div
                          key={bm.id}
                          className={`reader-bookmark-item ${bm.page === currentPage ? 'active' : ''}`}
                          onClick={() => handleGoToBookmark(bm.page)}
                        >
                          <BookmarkCheck size={12} style={{ color: bm.color }} />
                          <span className="reader-bookmark-label">{bm.label}</span>
                          <button
                            className="reader-bookmark-delete"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await removeBookmark(book.id, bm.id);
                              setBookmarks(prev => prev.filter(b => b.id !== bm.id));
                            }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Group 4: View */}
          <div className="reader-toolbar-group">
            <button
              className={`btn-icon ${showSearch ? 'active' : ''}`}
              onClick={() => {
                setShowSearch(!showSearch);
                if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 100);
              }}
              title="Buscar en libro (Ctrl+F)"
            >
              <Search size={14} />
            </button>
            <button className="btn-icon" onClick={handleFullscreen} title="Pantalla completa">
              <Maximize size={14} />
            </button>
          </div>

          {/* TTS */}
          <TtsControls
            text={pageText || `${book.title}. Página ${currentPage}`}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(p) => {
              setCurrentPage(p);
              setPageInput(String(p));
            }}
            fetchPageText={async (page: number) => {
              try {
                const result = await fetchBookText(book.id, page, page);
                return result.fullText?.trim() || '';
              } catch {
                return '';
              }
            }}
          />

          {/* AI Toggle — Premium button */}
          <button
            className={`reader-ai-toggle ${showAiPanel ? 'active' : ''}`}
            onClick={() => setShowAiPanel(!showAiPanel)}
          >
            <Bot size={14} /> Hermes
          </button>
        </div>
      </div>

      {/* In-book search panel */}
      {showSearch && (
        <div className="reader-search-bar">
          <div className="reader-search-input-row">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              className="reader-search-input"
              placeholder="Buscar en este libro..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && searchQuery.length >= 2) {
                  setIsSearching(true);
                  try {
                    const data = await apiSearchInBook(book.id, searchQuery);
                    setSearchResults(data.results || []);
                  } catch { setSearchResults([]); }
                  setIsSearching(false);
                }
                if (e.key === 'Escape') setShowSearch(false);
              }}
            />
            <span className="reader-search-hint">
              {isSearching ? 'Buscando...' : searchResults.length > 0 ? `${searchResults.length} resultados` : 'Enter para buscar'}
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowSearch(false)}>
              <X size={12} />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="reader-search-results">
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  className={`reader-search-result ${r.page === currentPage ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentPage(r.page);
                    setPageInput(String(r.page));
                  }}
                >
                  <span className="reader-search-page">p.{r.page}</span>
                  <span className="reader-search-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="reader-progress">
        <div className="reader-progress-fill" style={{ width: `${progress}%` }} />
        {/* Bookmark markers on progress bar */}
        {bookmarks.map((bm) => (
          <div
            key={bm.id}
            className="reader-progress-bookmark"
            style={{ left: `${(bm.page / Math.max(totalPages, 1)) * 100}%` }}
            title={bm.label}
            onClick={() => handleGoToBookmark(bm.page)}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="reader-body">
        <div className={`reader-content ${theme !== 'default' && theme !== 'night' ? 'reader-themed' : ''}`}
             style={themeConfig.filterCSS ? { '--reader-filter': themeConfig.filterCSS } as React.CSSProperties : {}}
        >
          {renderViewer()}
        </div>

        {/* AI Panel */}
        {showAiPanel && (
          <AiChatPanel
            book={book}
            currentPage={currentPage}
            onClose={() => setShowAiPanel(false)}
            onNavigate={(action) => {
              if (onNavigate) {
                onClose();
                onNavigate(action);
              }
            }}
          />
        )}
      </div>

      {/* Navigation bar */}
      {book.format !== 'image' && totalPages > 0 && (
        <div className="reader-nav">
          <button
            className="btn btn-ghost btn-icon"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
          >
            <ChevronLeft size={18} />
          </button>

          <div className="reader-nav-page">
            <span>{pageLayout === 'double' ? 'Páginas' : 'Página'}</span>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => handlePageInput(e.target.value)}
            />
            <span>de {totalPages}</span>
          </div>

          <button
            className="btn btn-ghost btn-icon"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* ═══ MOBILE FAB + BOTTOM SHEET ═══ */}

      {/* FAB Button */}
      <button
        className={`reader-fab ${showMobileMenu ? 'open' : ''}`}
        onClick={() => { setShowMobileMenu(!showMobileMenu); setMobileSubView('none'); }}
      >
        <Plus size={22} />
      </button>

      {/* Backdrop */}
      {showMobileMenu && (
        <div
          className="reader-fab-backdrop"
          onClick={() => { setShowMobileMenu(false); setMobileSubView('none'); }}
        />
      )}

      {/* Bottom Sheet */}
      {showMobileMenu && (
        <div className="reader-bottom-sheet">
          <div className="reader-sheet-handle" />
          <p className="reader-sheet-title">Herramientas</p>

          {/* Zoom Row */}
          <div className="reader-sheet-zoom">
            <button onClick={handleZoomOut}><ZoomOut size={18} /></button>
            <span className="zoom-value">{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn}><ZoomIn size={18} /></button>
          </div>

          {/* Theme Row (conditional) */}
          {mobileSubView === 'themes' && (
            <div className="reader-sheet-themes">
              {(Object.keys(THEME_CONFIG) as ReaderTheme[]).map((t) => (
                <button
                  key={t}
                  className={`reader-sheet-theme-btn ${t === theme ? 'active' : ''}`}
                  onClick={() => { setTheme(t); setMobileSubView('none'); }}
                >
                  <span className="theme-icon">{THEME_CONFIG[t].icon}</span>
                  <span>{THEME_CONFIG[t].label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Bookmarks (conditional) */}
          {mobileSubView === 'bookmarks' && (
            <div className="reader-sheet-bookmarks">
              {bookmarks.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>
                  Sin marcadores aún. Usa el botón "Marcar" para agregar uno.
                </p>
              ) : (
                bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className={`reader-bookmark-item ${bm.page === currentPage ? 'active' : ''}`}
                    onClick={() => { handleGoToBookmark(bm.page); setShowMobileMenu(false); }}
                  >
                    <BookmarkCheck size={14} style={{ color: bm.color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{bm.label}</span>
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await removeBookmark(book.id, bm.id);
                        setBookmarks(prev => prev.filter(b => b.id !== bm.id));
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tool Grid */}
          <div className="reader-sheet-grid">
            {book.format !== 'image' && (
              <button
                className={`reader-sheet-btn ${pageLayout === 'single' ? 'active' : ''}`}
                onClick={() => setPageLayout(pageLayout === 'single' ? 'double' : 'single')}
              >
                {pageLayout === 'single' ? <Columns2 size={20} /> : <BookOpen size={20} />}
                <span className="sheet-btn-label">
                  {pageLayout === 'single' ? 'Doble' : 'Simple'}
                </span>
              </button>
            )}

            <button
              className={`reader-sheet-btn ${mobileSubView === 'themes' ? 'active' : ''}`}
              onClick={() => setMobileSubView(mobileSubView === 'themes' ? 'none' : 'themes')}
            >
              <Palette size={20} />
              <span className="sheet-btn-label">Tema</span>
            </button>

            <button
              className={`reader-sheet-btn ${isCurrentPageBookmarked ? 'active' : ''}`}
              onClick={() => { handleToggleBookmark(); }}
            >
              {isCurrentPageBookmarked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
              <span className="sheet-btn-label">
                {isCurrentPageBookmarked ? 'Marcado' : 'Marcar'}
              </span>
            </button>

            <button
              className={`reader-sheet-btn ${mobileSubView === 'bookmarks' ? 'active' : ''}`}
              onClick={() => setMobileSubView(mobileSubView === 'bookmarks' ? 'none' : 'bookmarks')}
            >
              <List size={20} />
              <span className="sheet-btn-label">Lista ({bookmarks.length})</span>
            </button>

            <button
              className="reader-sheet-btn"
              onClick={() => {
                setShowSearch(true);
                setShowMobileMenu(false);
                setTimeout(() => searchInputRef.current?.focus(), 200);
              }}
            >
              <Search size={20} />
              <span className="sheet-btn-label">Buscar</span>
            </button>

            <button className="reader-sheet-btn" onClick={() => { handleFullscreen(); setShowMobileMenu(false); }}>
              <Maximize size={20} />
              <span className="sheet-btn-label">Completa</span>
            </button>

            <button
              className="reader-sheet-btn"
              onClick={() => {
                setShowMobileMenu(false);
                // Scroll to TTS in toolbar — on mobile, just toggle the panel
              }}
            >
              <Volume2 size={20} />
              <span className="sheet-btn-label">Narrar</span>
            </button>

            <button
              className={`reader-sheet-btn ${showAiPanel ? 'active' : ''}`}
              onClick={() => { setShowAiPanel(!showAiPanel); setShowMobileMenu(false); }}
            >
              <Bot size={20} />
              <span className="sheet-btn-label">Hermes</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
