import { useState, useEffect, useRef, useCallback } from 'react';
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
}: LibraryGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset visible count when books change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [books]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || visibleCount >= books.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, books.length));
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, books.length]);

  const visibleBooks = books.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div>
        {showBack && onBack && (
          <button className="library-breadcrumb" onClick={onBack}>
            <ArrowLeft size={16} />
            <span className="breadcrumb-home">Inicio</span>
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
            <span className="breadcrumb-home">Inicio</span>
            <ChevronRight size={12} className="breadcrumb-sep" />
            <span className="breadcrumb-current">{sectionTitle}</span>
          </button>
        )}
        <div className="library-section-header">
          <h2>{sectionTitle}</h2>
        </div>
        <div className="library-empty-category">
          <Library size={48} strokeWidth={1} />
          <p>No hay libros en esta sección aún.</p>
          <button className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft size={14} /> Volver al inicio
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
          <span className="breadcrumb-home">Inicio</span>
          <ChevronRight size={12} className="breadcrumb-sep" />
          <span className="breadcrumb-current">{sectionTitle}</span>
        </button>
      )}
      <div className="library-section-header">
        <h2>{sectionTitle}</h2>
        <span>
          {visibleCount < books.length
            ? `${visibleCount.toLocaleString()} de ${books.length.toLocaleString()} libros`
            : `${books.length.toLocaleString()} libros`}
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
      {visibleCount < books.length && (
        <div ref={loadMoreRef} className="library-load-more">
          <div className="skeleton" style={{ width: 200, height: 20, margin: '20px auto' }} />
        </div>
      )}
    </div>
  );
}

function WelcomeBanner({ onScan }: { onScan: () => void }) {
  return (
    <div className="welcome-banner">
      <h2>Bienvenido a BiblioVault AI</h2>
      <p>
        Tu biblioteca personal inteligente. Escanea tu colección de libros para empezar
        a explorar, leer, y conversar con AI sobre tus lecturas.
      </p>
      <div className="welcome-banner-actions">
        <button className="btn btn-primary" onClick={onScan}>
          <ScanLine size={16} /> Escanear Biblioteca
        </button>
        <button className="btn btn-secondary">
          <Sparkles size={16} /> Ver Demo
        </button>
      </div>
    </div>
  );
}
