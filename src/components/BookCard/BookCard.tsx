import { BookOpen, Heart, Info, FileText, Image, ScanLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Book, ViewMode } from '../../types';
import { getBookCoverUrl } from '../../services/api';
import './BookCard.css';

interface BookCardProps {
  book: Book;
  viewMode: ViewMode;
  onRead: (book: Book) => void;
  onDetail: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
}

const FORMAT_BADGE: Record<string, { className: string; label: string }> = {
  epub: { className: 'badge badge-epub', label: 'EPUB' },
  pdf: { className: 'badge badge-pdf', label: 'PDF' },
  doc: { className: 'badge badge-doc', label: 'DOC' },
  image: { className: 'badge badge-img', label: 'IMG' },
};

function getBadge(book: Book) {
  if (book.contentType === 'scan') {
    return { className: 'badge badge-scan', label: 'SCAN' };
  }
  return FORMAT_BADGE[book.format] || FORMAT_BADGE.pdf;
}

export default function BookCard({ book, viewMode, onRead, onDetail, onToggleFavorite }: BookCardProps) {
  const { t } = useTranslation();
  const badge = getBadge(book);
  const coverUrl = getBookCoverUrl(book.id);

  if (viewMode === 'list') {
    return (
      <div className="book-card-list" onClick={() => onDetail(book)}>
        <div className="book-card-list-cover">
          <img src={coverUrl} alt={book.title} loading="lazy" onLoad={(e) => {
            (e.target as HTMLImageElement).classList.add('loaded');
          }} onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
          }} />
          <div className="book-card-cover-placeholder">
            <FileText />
          </div>
        </div>
        <div className="book-card-list-info">
          <div className="book-card-list-title">{book.title}</div>
          <div className="book-card-list-author">{book.author || t('bookCard.unknownAuthor')}</div>
        </div>
        <div className="book-card-list-meta">
          <span className={badge.className}>{badge.label}</span>
          {book.readingProgress > 0 && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-primary)' }}>
              {Math.round(book.readingProgress * 100)}%
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="book-card" onClick={() => onDetail(book)}>
      <div className="book-card-cover">
        <img src={coverUrl} alt={book.title} loading="lazy" onLoad={(e) => {
          (e.target as HTMLImageElement).classList.add('loaded');
        }} onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }} />
        <div className="book-card-cover-placeholder">
          {book.format === 'image' ? <Image /> : <FileText />}
          <span>{book.title}</span>
        </div>

        <div className="book-card-badge">
          <span className={badge.className}>{badge.label}</span>
        </div>

        <button
          className={`book-card-fav ${book.favorite ? 'is-fav' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(book);
          }}
          title={book.favorite ? t('bookCard.removeFavorite') : t('bookCard.addFavorite')}
        >
          <Heart fill={book.favorite ? 'currentColor' : 'none'} />
        </button>

        <div className="book-card-overlay">
          <div className="book-card-overlay-actions">
            <button
              className="book-card-overlay-read"
              onClick={(e) => {
                e.stopPropagation();
                onRead(book);
              }}
            >
              <BookOpen size={12} /> {t('bookCard.read')}
            </button>
            <button
              className="book-card-overlay-info"
              onClick={(e) => {
                e.stopPropagation();
                onDetail(book);
              }}
            >
              <Info size={12} /> {t('bookCard.info')}
            </button>
          </div>
        </div>

        {book.readingProgress > 0 && (
          <div className="book-card-progress">
            <div
              className="book-card-progress-fill"
              style={{ width: `${book.readingProgress * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="book-card-info">
        <div className="book-card-title">{book.title}</div>
        <div className="book-card-author">{book.author || t('bookCard.unknownAuthor')}</div>
        {book.category && (
          <div className="book-card-category">{book.category}</div>
        )}
      </div>
    </div>
  );
}
