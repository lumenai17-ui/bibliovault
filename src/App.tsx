import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import Header from './components/Header/Header';
import LibraryGrid from './components/Library/LibraryGrid';
import UnifiedReader from './components/Reader/UnifiedReader';
import BookDetail from './components/BookDetail/BookDetail';
import Statistics from './components/Dashboard/Statistics';
import CategoriesDashboard from './components/Dashboard/CategoriesDashboard';
import AuthPage, { type AuthUser } from './components/Auth/AuthPage';
import CommunityExplorer from './components/Community/CommunityExplorer';
import type { Book, ViewMode, BookFormat } from './types';
import {
  fetchBooks,
  fetchBook,
  fetchStats,
  fetchCategories,
  fetchCollections,
  startScan,
  fetchScanStatus,
  updateBook as apiUpdateBook,
  ApiConnectionError,
  type ApiBook,
  type ApiCategory,
} from './services/api';
import type { AiAction } from './services/ai';
import type { Collection } from './types';

/** Map API book to frontend Book type */
function mapBook(b: ApiBook): Book {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    description: b.description,
    isbn: b.isbn,
    language: b.language,
    pages: b.pages,
    format: (['epub', 'pdf', 'doc', 'image'].includes(b.format) ? b.format : 'pdf') as BookFormat,
    contentType: b.content_type as Book['contentType'],
    filePath: b.file_path,
    fileSize: b.file_size,
    coverPath: b.cover_path || '',
    category: b.category_name || b.folder_category || '',
    subcategory: b.subcategory,
    tags: JSON.parse(b.tags || '[]'),
    dateAdded: b.date_added,
    lastRead: b.last_read,
    readingProgress: b.reading_progress,
    favorite: !!b.favorite,
    ocrStatus: b.ocr_status as Book['ocrStatus'],
    aiSummary: b.ai_summary,
  };
}

function getSectionTitle(section: string): string {
  const titles: Record<string, string> = {
    all: 'Toda la Biblioteca',
    favorites: 'Favoritos',
    reading: 'Leyendo Ahora',
    recent: 'Agregados Recientemente',
  };
  return titles[section] || 'Biblioteca';
}

export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [activeSection, setActiveSection] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeFormat, setActiveFormat] = useState<BookFormat | 'all'>('all');
  const [books, setBooks] = useState<Book[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [stats, setStats] = useState({ total: 0, favorites: 0, reading: 0, categories: 0 });
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [detailBook, setDetailBook] = useState<Book | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Check session on startup
  useEffect(() => {
    const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
    fetch(`${base}/api/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setCurrentUser(data.user))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthChecking(false));
  }, []);

  // Load books from API
  const loadBooks = useCallback(async () => {
    if (!currentUser) return; // Don't load if not authenticated
    setIsLoading(true);
    try {
      const params: Parameters<typeof fetchBooks>[0] = { limit: 2000 };

      if (activeFormat !== 'all') params.format = activeFormat;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (activeSection === 'favorites') params.favorite = true;
      if (activeSection.startsWith('cat-')) {
        params.category_id = parseInt(activeSection.replace('cat-', ''));
      }
      if (activeSection.startsWith('col-')) {
        params.collection_id = parseInt(activeSection.replace('col-', ''));
      }

      const result = await fetchBooks(params);
      let mapped = result.books.map(mapBook);

      // Client-side section filtering
      if (activeSection === 'reading') {
        mapped = mapped.filter((b) => b.readingProgress > 0 && b.readingProgress < 1);
      } else if (activeSection === 'recent') {
        mapped.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
        mapped = mapped.slice(0, 50);
      }

      setBooks(mapped);
      setTotalBooks(result.total);
      setConnectionError(null); // Clear error on success
    } catch (err) {
      if (err instanceof ApiConnectionError) {
        setConnectionError(err.message);
      }
      console.error('Failed to load books:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeSection, activeFormat, searchQuery, currentUser]);

  // Load stats, categories, and collections
  const loadMeta = useCallback(async () => {
    if (!currentUser) return; // Don't load if not authenticated
    try {
      const [statsData, catsData, colsData] = await Promise.all([
        fetchStats(), 
        fetchCategories(),
        fetchCollections()
      ]);
      setStats({
        total: statsData.total,
        favorites: statsData.favorites,
        reading: statsData.reading,
        categories: statsData.categories,
      });
      setCategories(catsData);
      setCollections(colsData);
    } catch (err) {
      console.error('Failed to load meta:', err);
    }
  }, [currentUser]);

  useEffect(() => { loadBooks(); }, [loadBooks]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Auto-retry on connection error
  useEffect(() => {
    if (!connectionError) return;
    const timer = setInterval(() => {
      loadBooks();
      loadMeta();
    }, 10000);
    return () => clearInterval(timer);
  }, [connectionError, loadBooks, loadMeta]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadBooks();
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleFavorite = async (book: Book) => {
    const newFav = !book.favorite;
    setBooks((prev) =>
      prev.map((b) => (b.id === book.id ? { ...b, favorite: newFav } : b))
    );
    await apiUpdateBook(book.id, { favorite: newFav ? 1 : 0 });
    loadMeta();
  };

  const handleScan = async () => {
    setIsScanning(true);
    await startScan();

    const interval = setInterval(async () => {
      const status = await fetchScanStatus();
      if (status.status === 'done' || status.status === 'error' || status.status === 'idle') {
        clearInterval(interval);
        setIsScanning(false);
        loadBooks();
        loadMeta();
      }
    }, 1000);
  };

  const handleOpenReader = async (book: Book) => {
    setDetailBook(null); // Close detail if open
    // Fetch fresh book data so reading_progress is up to date
    try {
      const freshData = await fetchBook(book.id);
      setActiveBook(mapBook(freshData));
    } catch {
      setActiveBook(book); // Fallback to cached data
    }
  };

  // Handle AI navigation actions from the reader chat
  const handleAiNavigate = useCallback(async (action: AiAction) => {
    switch (action.type) {
      case 'search':
        setSearchQuery(action.value);
        setActiveSection('all');
        break;
      case 'category': {
        // Find category by name (case-insensitive)
        const cat = categories.find(
          (c) => (c as any).name?.toLowerCase() === action.value.toLowerCase()
        );
        if (cat) {
          setActiveSection(`cat-${cat.id}`);
        } else {
          // Fallback: use search
          setSearchQuery(action.value);
        }
        break;
      }
      case 'open': {
        const bookId = parseInt(action.value);
        if (!isNaN(bookId)) {
          try {
            const freshData = await fetchBook(bookId);
            setActiveBook(mapBook(freshData));
          } catch {
            // Book not found — search for it instead
            setSearchQuery(action.value);
          }
        }
        break;
      }
      case 'navigate':
        if (action.value === 'library') setActiveSection('all');
        else if (action.value === 'favorites') setActiveSection('favorites');
        else if (action.value === 'reading') setActiveSection('reading');
        else if (action.value === 'recent') setActiveSection('recent');
        break;
    }
  }, [categories]);

  // ── Auth gates (AFTER all hooks) ──
  if (authChecking) {
    return (
      <div style={{ 
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)', color: 'var(--text-muted)' 
      }}>
        Cargando...
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage onAuthSuccess={(user) => setCurrentUser(user)} />;
  }

  // If a book is open in the reader, show the reader overlay
  if (activeBook) {
    return (
      <UnifiedReader
        book={activeBook}
        onClose={() => {
          setActiveBook(null);
          loadBooks(); // Refresh to show updated progress
        }}
        onNavigate={handleAiNavigate}
      />
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onUpdateCollections={loadMeta}
        stats={stats}
        categories={categories}
        collections={collections}
      />
      <main className="app-main">
        <Header
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          activeFormat={activeFormat}
          onFormatChange={setActiveFormat}
          onScan={handleScan}
          isScanning={isScanning}
          onRefresh={loadBooks}
        />
        <div className="app-content">
          {/* Connection error banner */}
          {connectionError && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(220,38,38,0.1))',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '12px',
              padding: '14px 20px',
              margin: '0 0 16px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              color: '#fca5a5',
              fontSize: '14px',
              backdropFilter: 'blur(10px)',
            }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <strong style={{ color: '#fecaca' }}>Conexión interrumpida</strong>
                <span style={{ opacity: 0.8, marginLeft: '8px' }}>{connectionError}</span>
                <span style={{ opacity: 0.5, marginLeft: '8px' }}>• Reintentando automáticamente...</span>
              </div>
            </div>
          )}
          {activeSection === 'home' ? (
            <CategoriesDashboard 
              categories={categories} 
              collections={collections} 
              books={books}
              onSelectSection={setActiveSection} 
            />
          ) : activeSection === 'stats' ? (
            <Statistics />
          ) : activeSection === 'community' ? (
            <CommunityExplorer onNavigateBack={() => setActiveSection('home')} />
          ) : (
            <LibraryGrid
              books={books}
              viewMode={viewMode}
              isLoading={isLoading}
              sectionTitle={getSectionTitle(activeSection)}
              onReadBook={handleOpenReader}
              onBookDetail={(book) => setDetailBook(book)}
              onToggleFavorite={handleToggleFavorite}
              onScan={handleScan}
            />
          )}
        </div>
      </main>

      {/* Book Detail Modal */}
      {detailBook && (
        <BookDetail
          book={detailBook}
          collections={collections}
          onClose={() => setDetailBook(null)}
          onRead={handleOpenReader}
          onToggleFavorite={handleToggleFavorite}
          onUpdate={() => {
            loadBooks();
            loadMeta();
            // Also refresh the detail modal with fresh data
            if (detailBook) {
              fetchBook(detailBook.id)
                .then((fresh) => setDetailBook(mapBook(fresh)))
                .catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}

