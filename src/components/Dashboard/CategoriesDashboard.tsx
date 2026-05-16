import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Folder, BookText, BookOpen, Layers, LibraryBig,
  Flame, Sparkles, BookMarked, Telescope, Brain,
  Globe2, Leaf, Atom, HeartPulse, History,
  Compass, Shield, Sword, Shapes, Library
} from 'lucide-react';
import type { ApiCategory } from '../../services/api';
import type { Collection, Book } from '../../types';
import './CategoriesDashboard.css';

interface CategoriesDashboardProps {
  categories: ApiCategory[];
  collections: Collection[];
  books: Book[];
  onSelectSection: (section: string) => void;
  userName?: string;
  stats?: { total: number; favorites: number; reading: number; categories: number };
}

const getCategoryIcon = (index: number) => {
  const icons = [
    Folder, BookText, Brain, Telescope, Leaf, 
    Atom, HeartPulse, History, Compass, Globe2,
    Shapes, Flame, Sparkles, BookMarked, Layers,
    Shield, Sword, LibraryBig, BookOpen
  ];
  const Icon = icons[index % icons.length];
  return <Icon size={24} strokeWidth={1.5} />;
};

const getCategoryColor = (index: number) => {
  const hues = [210, 260, 320, 150, 40, 0, 180, 290, 10];
  const hue = hues[index % hues.length];
  return `hsl(${hue}, 70%, 60%)`;
};

// URL helper for covers
const getCoverUrl = (bookId: number) => `${import.meta.env.DEV ? 'http://localhost:3001' : ''}/api/books/${bookId}/cover`;

export default function CategoriesDashboard({ categories, collections, books, onSelectSection, userName, stats }: CategoriesDashboardProps) {
  const { t } = useTranslation();
  
  // Pre-calculate 3 sample books with REAL covers per category (skip SVG placeholders)
  const categoryFanCovers = useMemo(() => {
    const map = new Map<number, number[]>(); // cat_id -> [book_id, book_id, book_id]
    for (const cat of categories) {
      const catBooks = books.filter(b => 
        (b.category === cat.name) && 
        b.coverPath && 
        !b.coverPath.endsWith('.svg') &&
        (b.coverPath.includes('supabase') || b.coverPath.includes('.jpg') || b.coverPath.includes('.png'))
      );
      // Take up to 3 books with real covers
      const selected = catBooks.slice(0, 3).map(b => b.id);
      // If we don't have 3 real covers, fill with any book that has a coverPath
      if (selected.length < 3) {
        const fallbacks = books.filter(b => 
          b.category === cat.name && b.coverPath && !selected.includes(b.id)
        );
        for (const fb of fallbacks) {
          if (selected.length >= 3) break;
          selected.push(fb.id);
        }
      }
      if (selected.length > 0) map.set(cat.id, selected);
    }
    return map;
  }, [categories, books]);

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('categories.goodMorning') : hour < 18 ? t('categories.goodAfternoon') : t('categories.goodEvening');

  return (
    <div className="categories-dashboard animate-fade-in">

      {/* Greeting Bar */}
      <div className="dashboard-greeting">
        <div className="greeting-icon">
          <Library size={20} />
        </div>
        <div className="greeting-text">
          <h2>{greeting}{userName ? `, ${userName}` : ''}</h2>
          {stats && (
            <p>
              {t('categories.statsTotalBooks', { count: stats.total })} · {t('categories.statsCategories', { count: stats.categories })}
              {stats.reading > 0 && <> · {t('categories.statsReading', { count: stats.reading })}</>}
            </p>
          )}
        </div>
      </div>
      
      {collections.length > 0 && (
        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <Layers className="section-icon" size={20} />
            <h2>{t('categories.myCollections')}</h2>
            <span className="section-count">{collections.length}</span>
          </div>
          <div className="dashboard-grid">
            {collections.map((col, index) => {
              const color = getCategoryColor(index + 5);
              return (
                <div 
                  key={`col-${col.id}`} 
                  className="dashboard-card collection-card"
                  onClick={() => onSelectSection(`col-${col.id}`)}
                  style={{ '--card-color': color } as React.CSSProperties}
                >
                  <div className="card-bg-icon">
                    <BookMarked size={24} strokeWidth={1.5} />
                  </div>
                  <div className="card-icon-wrapper">
                    <BookMarked size={24} strokeWidth={1.5} />
                  </div>
                  <div className="card-info">
                    <h3>{col.name}</h3>
                    <span className="card-meta">
                      {(col.book_count || 0) === 1 
                        ? t('categories.bookCount_one', { count: 1 }) 
                        : t('categories.bookCount_other', { count: col.book_count || 0 })}
                    </span>
                  </div>
                  {col.description && <p className="card-desc">{col.description}</p>}
                  <div className="card-glow" />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="dashboard-section">
        <div className="dashboard-section-header">
          <LibraryBig className="section-icon" size={20} />
          <h2>{t('categories.exploreCategories')}</h2>
          <span className="section-count">{categories.length}</span>
        </div>
        <div className="dashboard-grid">
          {categories.map((cat, index) => {
            const color = getCategoryColor(index);
            const fanBookIds = categoryFanCovers.get(cat.id) || [];
            return (
              <div 
                key={`cat-${cat.id}`} 
                className="dashboard-card category-card"
                onClick={() => onSelectSection(`cat-${cat.id}`)}
                style={{ 
                  '--card-color': color,
                } as React.CSSProperties}
              >
                {/* Fan cover spread */}
                {fanBookIds.length > 0 && (
                  <div className="card-fan-covers">
                    {fanBookIds.slice(0, 3).map((bookId, i) => (
                      <img
                        key={bookId}
                        src={getCoverUrl(bookId)}
                        alt=""
                        className={`card-fan-book card-fan-book--${i + 1}`}
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ))}
                  </div>
                )}
                <div className="card-bg-icon">
                  {getCategoryIcon(index)}
                </div>
                <div className="card-info" style={{ zIndex: 2 }}>
                  <h3>{cat.name}</h3>
                  <span className="card-meta">
                    {cat.book_count === 1 
                      ? t('categories.bookCount_one', { count: 1 }) 
                      : t('categories.bookCount_other', { count: cat.book_count })}
                  </span>
                </div>
                <div className="card-glow" />
              </div>
            );
          })}
        </div>
      </section>
      
    </div>
  );
}
