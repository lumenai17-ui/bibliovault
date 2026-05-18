import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Library, ScanLine, Sparkles, ArrowLeft, ChevronRight } from 'lucide-react';
import BookCard from '../BookCard/BookCard';
import type { Book, ViewMode } from '../../types';
import './LibraryGrid.css';

interface LibraryGridProps {
  books: Book[];
  viewMode: ViewMode;
  isLoading: boolean;
  sectionTitle: string;
  onReadBook: (book: Book) => void;
  onBookDetail: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  onScan: () => void;
  showBack?: boolean;
  onBack?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const PAGE_SIZE = 48; // Load 48 books at a time (6 columns × 8 rows)

export default function LibraryGrid({
  books,
  viewMode,
  isLoading,
  sectionTitle,
  onReadBook,
  onBookDetail,
  onToggleFavorite,
  onScan,
  showBack = false,
  onBack,
  hasMore = false,
  onLoadMore,
}: LibraryGridProps) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset visible count when books change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [books]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (visibleCount < books.length) {
            setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, books.length));
          } else if (hasMore && onLoadMore) {
            onLoadMore();
          }
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, books.length, hasMore, onLoadMore]);

  const visibleBooks = books.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div>
        {showBack && onBack && (
          <button className="library-breadcrumb" onClick={onBack}>
            <ArrowLeft size={16} />
            <span className="breadcrumb-home">{t('library.breadcrumbHome')}</span>
            <ChevronRight size={12} className="breadcrumb-sep" />
            <span className="breadcrumb-current">{sectionTitle}</span>
          </button>
        )}
        <div className="library-section-header">
          <h2>{sectionTitle}</h2>
        </div>
        <div className="library-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="book-card">
              <div className="book-card-cover">
                <div className="skeleton" style={{ width: '100%', aspectRatio: '2/3' }} />
              </div>
              <div className="book-card-info">
                <div className="skeleton" style={{ width: '80%', height: 14, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: '50%', height: 11 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (books.length === 0 && !showBack) {
    return (
      <div>
        <WelcomeBanner onScan={onScan} />
      </div>
    );
  }

  if (books.length === 0 && showBack) {
    return (
      <div>
        {onBack && (
          <button className="library-breadcrumb" onClick={onBack}>
            <ArrowLeft size={16} />
            <span className="breadcrumb-home">{t('library.breadcrumbHome')}</span>
            <ChevronRight size={12} className="breadcrumb-sep" />
            <span className="breadcrumb-current">{sectionTitle}</span>
          </button>
        )}
        <div className="library-section-header">
          <h2>{sectionTitle}</h2>
        </div>
        <div className="library-empty-category">
          <Library size={48} strokeWidth={1} />
          <p>{t('library.emptySection')}</p>
          <button className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft size={14} /> {t('library.backHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {showBack && onBack && (
        <button className="library-breadcrumb" onClick={onBack}>
          <ArrowLeft size={16} />
          <span className="breadcrumb-home">{t('library.breadcrumbHome')}</span>
          <ChevronRight size={12} className="breadcrumb-sep" />
          <span className="breadcrumb-current">{sectionTitle}</span>
        </button>
      )}
      <div className="library-section-header">
        <h2>{sectionTitle}</h2>
        <span>
          {visibleCount < books.length
            ? t('library.showingCount', { visible: visibleCount.toLocaleString(), total: books.length.toLocaleString() })
            : t('library.totalCount', { total: books.length.toLocaleString() })}
        </span>
      </div>
      <div className={viewMode === 'grid' ? 'library-grid' : 'library-list'}>
        {visibleBooks.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            viewMode={viewMode}
            onRead={onReadBook}
            onDetail={onBookDetail}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
      {/* Load more trigger */}
      {(visibleCount < books.length || hasMore) && (
        <div ref={loadMoreRef} className="library-load-more">
          <div className="skeleton" style={{ width: 200, height: 20, margin: '20px auto' }} />
        </div>
      )}
    </div>
  );
}

function WelcomeBanner({ onScan }: { onScan: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="welcome-banner">
      <h2>{t('library.welcomeTitle')}</h2>
      <p>{t('library.welcomeDesc')}</p>
      <div className="welcome-banner-actions">
        <button className="btn btn-primary" onClick={onScan}>
          <ScanLine size={16} /> {t('library.scanBtn')}
        </button>
        <button className="btn btn-secondary">
          <Sparkles size={16} /> {t('library.demoBtn')}
        </button>
      </div>
    </div>
  );
}
