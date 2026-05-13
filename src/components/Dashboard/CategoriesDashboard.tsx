import React, { useMemo } from 'react';
import { 
  Folder, BookText, BookOpen, Layers, LibraryBig,
  Flame, Sparkles, BookMarked, Telescope, Brain,
  Globe2, Leaf, Atom, HeartPulse, History,
  Compass, Shield, Sword, Shapes
} from 'lucide-react';
import type { ApiCategory } from '../../services/api';
import type { Collection, Book } from '../../types';
import './CategoriesDashboard.css';

interface CategoriesDashboardProps {
  categories: ApiCategory[];
  collections: Collection[];
  books: Book[];
  onSelectSection: (section: string) => void;
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

export default function CategoriesDashboard({ categories, collections, books, onSelectSection }: CategoriesDashboardProps) {
  
  // Pre-calculate sample books for background covers
  const categoryCovers = useMemo(() => {
    const map = new Map<number, number>(); // cat_id -> book_id
    for (const cat of categories) {
      const book = books.find(b => 
        (b.category === cat.name || b.category === cat.name) && b.coverPath
      );
      if (book) map.set(cat.id, book.id);
    }
    return map;
  }, [categories, books]);

  return (
    <div className="categories-dashboard animate-fade-in">
      
      {collections.length > 0 && (
        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <Layers className="section-icon" size={20} />
            <h2>Mis Colecciones</h2>
            <span className="section-count">{collections.length}</span>
          </div>
          <div className="dashboard-grid">
            {collections.map((col, index) => {
              const color = getCategoryColor(index + 5); // Offset colors for collections
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
                      {col.book_count || 0} {(col.book_count || 0) === 1 ? 'libro' : 'libros'}
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
          <h2>Explorar Categorías</h2>
          <span className="section-count">{categories.length}</span>
        </div>
        <div className="dashboard-grid">
          {categories.map((cat, index) => {
            const color = getCategoryColor(index);
            const coverBookId = categoryCovers.get(cat.id);
            return (
              <div 
                key={`cat-${cat.id}`} 
                className="dashboard-card category-card"
                onClick={() => onSelectSection(`cat-${cat.id}`)}
                style={{ 
                  '--card-color': color,
                } as React.CSSProperties}
              >
                {coverBookId && (
                  <div 
                    className="card-bg-image" 
                    style={{ backgroundImage: `url(${getCoverUrl(coverBookId)})` }}
                  />
                )}
                <div className="card-bg-icon">
                  {getCategoryIcon(index)}
                </div>
                <div className="card-icon-wrapper">
                  {getCategoryIcon(index)}
                </div>
                <div className="card-info">
                  <h3>{cat.name}</h3>
                  <span className="card-meta">
                    {cat.book_count} {cat.book_count === 1 ? 'libro' : 'libros'}
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
