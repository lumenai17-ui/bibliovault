import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_DIR = join(__dirname, '..', 'data');
export const DB_PATH = join(DB_DIR, 'bibliovault.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id),
      ai_suggested INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      description TEXT DEFAULT '',
      isbn TEXT DEFAULT '',
      language TEXT DEFAULT '',
      pages INTEGER DEFAULT 0,
      format TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      file_path TEXT UNIQUE NOT NULL,
      file_name TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      cover_path TEXT DEFAULT '',
      category_id INTEGER REFERENCES categories(id),
      subcategory TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      date_added TEXT DEFAULT (datetime('now')),
      last_read TEXT,
      reading_progress REAL DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      ocr_status TEXT DEFAULT 'none',
      ai_summary TEXT,
      folder_category TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      position TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      messages TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      label TEXT DEFAULT '',
      color TEXT DEFAULT '#667eea',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_books_format ON books(format);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_id);
    CREATE INDEX IF NOT EXISTS idx_books_favorite ON books(favorite);
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#667eea',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_collections (
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (book_id, collection_id)
    );

    -- ══════════════════════════════════════════
    --  Phase 11: Multi-user tables
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      plan TEXT DEFAULT 'free',
      avatar_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS user_reading_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      progress REAL DEFAULT 0,
      last_read TEXT DEFAULT (datetime('now')),
      current_page INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS user_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      shared_globally INTEGER DEFAULT 0,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS affiliate_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      price_estimate REAL,
      currency TEXT DEFAULT 'USD',
      last_checked TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
      clicked_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for multi-user tables
    CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_progress_user ON user_reading_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_uploads_user ON user_uploads(user_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_links_book ON affiliate_links(book_id);
  `);

  // ── Migrations (safe column additions) ──

  const booksCols = db.prepare("PRAGMA table_info(books)").all() as { name: string }[];
  const booksColNames = new Set(booksCols.map(c => c.name));

  if (!booksColNames.has('enriched')) {
    db.exec("ALTER TABLE books ADD COLUMN enriched INTEGER DEFAULT 0");
  }
  if (!booksColNames.has('original_title')) {
    db.exec("ALTER TABLE books ADD COLUMN original_title TEXT DEFAULT ''");
  }
  if (!booksColNames.has('cover_source')) {
    db.exec("ALTER TABLE books ADD COLUMN cover_source TEXT DEFAULT 'svg'");
  }
  if (!booksColNames.has('enrichment_source')) {
    db.exec("ALTER TABLE books ADD COLUMN enrichment_source TEXT DEFAULT ''");
  }

  // Add user_id to existing tables that need it
  const collectionsCols = db.prepare("PRAGMA table_info(collections)").all() as { name: string }[];
  if (!collectionsCols.some(c => c.name === 'user_id')) {
    db.exec("ALTER TABLE collections ADD COLUMN user_id TEXT DEFAULT NULL");
  }

  const bookmarksCols = db.prepare("PRAGMA table_info(bookmarks)").all() as { name: string }[];
  if (!bookmarksCols.some(c => c.name === 'user_id')) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN user_id TEXT DEFAULT NULL");
  }

  const sessionsCols = db.prepare("PRAGMA table_info(reading_sessions)").all() as { name: string }[];
  if (!sessionsCols.some(c => c.name === 'user_id')) {
    db.exec("ALTER TABLE reading_sessions ADD COLUMN user_id TEXT DEFAULT NULL");
  }

  const aiCols = db.prepare("PRAGMA table_info(ai_conversations)").all() as { name: string }[];
  if (!aiCols.some(c => c.name === 'user_id')) {
    db.exec("ALTER TABLE ai_conversations ADD COLUMN user_id TEXT DEFAULT NULL");
  }

  // Migration: Collections UNIQUE(name) → UNIQUE(name, user_id)
  // So each user can have their own "Favorites" collection
  try {
    const hasOldUnique = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='collections'"
    ).get() as { sql: string } | undefined;
    if (hasOldUnique?.sql?.includes('name TEXT NOT NULL UNIQUE') && !hasOldUnique.sql.includes('user_id')) {
      // Table still has the old schema — the user_id column was added via ALTER
      // Create a unique index that allows per-user duplicate names
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_user ON collections(name, user_id)');
      console.log('📋 Added per-user unique constraint on collections(name, user_id)');
    }
  } catch { /* index may already exist */ }

  // Migration: Fix .doc/.docx books that were incorrectly stored as format='pdf'
  const docFixed = db.prepare(`
    UPDATE books SET format = 'doc' 
    WHERE format = 'pdf' 
    AND (file_path LIKE '%.doc' OR file_path LIKE '%.docx')
  `).run();
  if (docFixed.changes > 0) {
    console.log(`📝 Fixed ${docFixed.changes} .doc/.docx books format (was 'pdf')`);
  }

  // ── Seed: Create default admin user for local development ──
  const adminExists = db.prepare("SELECT id FROM users WHERE email = 'admin@bibliovault.local'").get();
  if (!adminExists) {
    // Password placeholder — the auth module will detect this is not a bcrypt hash
    // and allow the first login to set the real password.
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, plan) 
      VALUES ('00000000-0000-0000-0000-000000000001', 'admin@bibliovault.local', 'PLACEHOLDER_NEEDS_RESET', 'Administrador', 'enterprise')
    `).run();
    console.log('👤 Default admin user created for local development');
  }

  // Seed default categories from the folder structure
  const defaultCategories = [
    'ANTEPASADOS', 'ASTRAL', 'AURA', 'AUTOAYUDA', 'CANALIZACIÓN',
    'CAUSALIDAD', 'CHAMANISMO', 'CIENCIA', 'CIVILIZACIONES', 'CONSCIENCIA',
    'DIMENSIONES', 'DIOSES', 'DROGAS', 'ELEMENTALES', 'ELITE',
    'EMOCIONES', 'ENEAGRAMA', 'ENERGÍA', 'ESOTERISMO', 'ESPIRITISMO',
    'FILOSOFÍA', 'GEMAS', 'GEOMETRÍA SAGRADA', 'INTUICIÓN', 'JINAS',
    'LEVITACIÓN', 'MAESTROS ASCENDIDOS', 'MANCIA', 'MEDITACIÓN', 'MUERTE',
    'NOVELAS', 'OCULTISMO', 'ONÍRICO', 'PLANTAS', 'PSIQUE',
    'RADIESTESIA', 'REENCARNACIÓN', 'RELIGIONES', 'SANACIÓN', 'TANTRA',
    'TIEMPO', 'UNIVERSO', 'VIBRACIÓN', 'ÁNGELES', 'INDIA',
    'Sin categoría',
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  const insertMany = db.transaction((cats: string[]) => {
    for (const c of cats) insert.run(c);
  });
  insertMany(defaultCategories);
}

// ── Book CRUD ──

export interface BookRow {
  id: number;
  title: string;
  author: string;
  description: string;
  isbn: string;
  language: string;
  pages: number;
  format: string;
  content_type: string;
  file_path: string;
  file_name: string;
  file_size: number;
  cover_path: string;
  category_id: number | null;
  subcategory: string;
  tags: string;
  date_added: string;
  last_read: string | null;
  reading_progress: number;
  favorite: number;
  ocr_status: string;
  ai_summary: string | null;
  folder_category: string;
}

export function insertBook(book: Omit<BookRow, 'id' | 'date_added'>) {
  const db = getDb();
  return db.prepare(`
    INSERT OR IGNORE INTO books (
      title, author, description, isbn, language, pages,
      format, content_type, file_path, file_name, file_size, cover_path,
      category_id, subcategory, tags, favorite, ocr_status, ai_summary, folder_category
    ) VALUES (
      @title, @author, @description, @isbn, @language, @pages,
      @format, @content_type, @file_path, @file_name, @file_size, @cover_path,
      @category_id, @subcategory, @tags, @favorite, @ocr_status, @ai_summary, @folder_category
    )
  `).run(book);
}

export function getAllBooks(limit = 2000, offset = 0, filters?: {
  format?: string;
  category_id?: number;
  favorite?: boolean;
  search?: string;
  collection_id?: number;
}) {
  const db = getDb();
  let where = 'WHERE 1=1';
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.format && filters.format !== 'all') {
    where += ' AND b.format = @format';
    params.format = filters.format;
  }
  if (filters?.category_id) {
    where += ' AND b.category_id = @category_id';
    params.category_id = filters.category_id;
  }
  if (filters?.favorite) {
    where += ' AND b.favorite = 1';
  }
  if (filters?.search) {
    where += ' AND (b.title LIKE @search OR b.author LIKE @search OR b.folder_category LIKE @search)';
    params.search = `%${filters.search}%`;
  }
  if (filters?.collection_id) {
    where += ' AND bc.collection_id = @collection_id';
    params.collection_id = filters.collection_id;
  }

  const joinCollections = filters?.collection_id ? 'JOIN book_collections bc ON bc.book_id = b.id' : '';

  const rows = db.prepare(`
    SELECT b.*, c.name as category_name
    FROM books b
    LEFT JOIN categories c ON b.category_id = c.id
    ${joinCollections}
    ${where}
    ORDER BY b.title ASC
    LIMIT @limit OFFSET @offset
  `).all(params);

  const total = db.prepare(`SELECT COUNT(*) as count FROM books b ${joinCollections} ${where}`).get(params) as { count: number };

  return { books: rows, total: total.count };
}

export function getBookById(id: number) {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, c.name as category_name
    FROM books b
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.id = @id
  `).get({ id });
}

export function updateBook(id: number, updates: Partial<BookRow>) {
  const db = getDb();
  
  // If title is changing, clear the AI summary so it regenerates
  if (updates.title) {
    updates.ai_summary = null as any;
  }

  const fields = Object.keys(updates)
    .filter(k => k !== 'id')
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!fields) return;
  return db.prepare(`UPDATE books SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

export function getCategories() {
  const db = getDb();
  return db.prepare(`
    SELECT c.*, COUNT(b.id) as book_count
    FROM categories c
    LEFT JOIN books b ON b.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();
}

export function getStats() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
  const favorites = (db.prepare('SELECT COUNT(*) as c FROM books WHERE favorite = 1').get() as { c: number }).c;
  const reading = (db.prepare('SELECT COUNT(*) as c FROM books WHERE reading_progress > 0 AND reading_progress < 1').get() as { c: number }).c;
  const byFormat = db.prepare('SELECT format, COUNT(*) as c FROM books GROUP BY format').all() as { format: string; c: number }[];
  const categories = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c;

  return {
    total,
    favorites,
    reading,
    categories,
    byFormat: Object.fromEntries(byFormat.map(r => [r.format, r.c])),
  };
}

export function getCategoryByName(name: string) {
  const db = getDb();
  return db.prepare('SELECT id FROM categories WHERE name = @name').get({ name }) as { id: number } | undefined;
}

export function bookExistsByPath(filePath: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM books WHERE file_path = @fp').get({ fp: filePath }) as { id: number } | undefined;
  return !!row;
}

export function getBooksWithoutCovers(limit = 2000) {
  const db = getDb();
  return db.prepare(`
    SELECT id, title, file_name, file_path, format, cover_source
    FROM books
    WHERE cover_source = 'svg' OR cover_source IS NULL OR cover_source = ''
    ORDER BY id ASC
    LIMIT @limit
  `).all({ limit }) as Array<{
    id: number;
    title: string;
    file_name: string;
    file_path: string;
    format: string;
    cover_source: string;
  }>;
}

export function getUnenrichedBooks(limit = 2000) {
  const db = getDb();
  return db.prepare(`
    SELECT id, title, author, file_name, file_path, format, enriched
    FROM books
    WHERE enriched = 0 OR enriched IS NULL
    ORDER BY id ASC
    LIMIT @limit
  `).all({ limit }) as Array<{
    id: number;
    title: string;
    author: string;
    file_name: string;
    file_path: string;
    format: string;
    enriched: number;
  }>;
}

// ── Collections CRUD (Per-User) ──

export interface CollectionRow {
  id: number;
  name: string;
  description: string;
  color: string;
  user_id?: string | null;
  book_count?: number;
}

export function getCollections(userId?: string | null) {
  const db = getDb();
  if (userId) {
    // Show user's own collections + legacy global ones (user_id IS NULL)
    return db.prepare(`
      SELECT c.*, COUNT(bc.book_id) as book_count
      FROM collections c
      LEFT JOIN book_collections bc ON bc.collection_id = c.id
      WHERE c.user_id = @userId OR c.user_id IS NULL
      GROUP BY c.id
      ORDER BY c.name ASC
    `).all({ userId }) as CollectionRow[];
  }
  // No user → only show legacy global collections
  return db.prepare(`
    SELECT c.*, COUNT(bc.book_id) as book_count
    FROM collections c
    LEFT JOIN book_collections bc ON bc.collection_id = c.id
    WHERE c.user_id IS NULL
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all() as CollectionRow[];
}

export function createCollection(name: string, description = '', color = '#667eea', userId?: string | null) {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO collections (name, description, color, user_id) VALUES (@name, @description, @color, @userId)'
  ).run({ name, description, color, userId: userId || null });
  return info.lastInsertRowid;
}

export function updateCollection(id: number, name: string, description: string, color: string, userId?: string | null) {
  const db = getDb();
  // Only update if owned by user or legacy (NULL)
  return db.prepare(
    'UPDATE collections SET name = @name, description = @description, color = @color WHERE id = @id AND (user_id = @userId OR user_id IS NULL)'
  ).run({ id, name, description, color, userId: userId || null });
}

export function deleteCollection(id: number, userId?: string | null) {
  const db = getDb();
  // Only delete if owned by user or legacy (NULL)
  return db.prepare(
    'DELETE FROM collections WHERE id = @id AND (user_id = @userId OR user_id IS NULL)'
  ).run({ id, userId: userId || null });
}

export function addBookToCollection(bookId: number, collectionId: number) {
  const db = getDb();
  return db.prepare('INSERT OR IGNORE INTO book_collections (book_id, collection_id) VALUES (@bookId, @collectionId)').run({ bookId, collectionId });
}

export function removeBookFromCollection(bookId: number, collectionId: number) {
  const db = getDb();
  return db.prepare('DELETE FROM book_collections WHERE book_id = @bookId AND collection_id = @collectionId').run({ bookId, collectionId });
}

export function getBookCollections(bookId: number, userId?: string | null) {
  const db = getDb();
  if (userId) {
    return db.prepare(`
      SELECT c.* 
      FROM collections c
      JOIN book_collections bc ON bc.collection_id = c.id
      WHERE bc.book_id = @bookId AND (c.user_id = @userId OR c.user_id IS NULL)
    `).all({ bookId, userId }) as CollectionRow[];
  }
  return db.prepare(`
    SELECT c.* 
    FROM collections c
    JOIN book_collections bc ON bc.collection_id = c.id
    WHERE bc.book_id = @bookId AND c.user_id IS NULL
  `).all({ bookId }) as CollectionRow[];
}

// ── Users CRUD ──

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  plan: string;
  avatar_url: string;
  created_at: string;
  last_login: string | null;
}

export function getUserById(id: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = @id').get({ id }) as UserRow | undefined;
}

export function getUserByEmail(email: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = @email').get({ email }) as UserRow | undefined;
}

export function createUser(id: string, email: string, passwordHash: string, displayName: string) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name)
    VALUES (@id, @email, @passwordHash, @displayName)
  `).run({ id, email, passwordHash, displayName });
}

export function updateUser(id: string, updates: Partial<Omit<UserRow, 'id' | 'password_hash'>>) {
  const db = getDb();
  const fields = Object.keys(updates)
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!fields) return;
  return db.prepare(`UPDATE users SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

export function updateUserPassword(id: string, passwordHash: string) {
  const db = getDb();
  return db.prepare('UPDATE users SET password_hash = @passwordHash WHERE id = @id').run({ id, passwordHash });
}

export function updateLastLogin(id: string) {
  const db = getDb();
  return db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = @id").run({ id });
}

// ── User Favorites ──

export function getUserFavorites(userId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, c.name as category_name
    FROM user_favorites uf
    JOIN books b ON b.id = uf.book_id
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE uf.user_id = @userId
    ORDER BY uf.created_at DESC
  `).all({ userId });
}

export function isUserFavorite(userId: string, bookId: number) {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM user_favorites WHERE user_id = @userId AND book_id = @bookId').get({ userId, bookId });
  return !!row;
}

export function addUserFavorite(userId: string, bookId: number) {
  const db = getDb();
  return db.prepare('INSERT OR IGNORE INTO user_favorites (user_id, book_id) VALUES (@userId, @bookId)').run({ userId, bookId });
}

export function removeUserFavorite(userId: string, bookId: number) {
  const db = getDb();
  return db.prepare('DELETE FROM user_favorites WHERE user_id = @userId AND book_id = @bookId').run({ userId, bookId });
}

export function countUserFavorites(userId: string) {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM user_favorites WHERE user_id = @userId').get({ userId }) as { c: number }).c;
}

// ── User Reading Progress ──

export function getUserReadingProgress(userId: string, bookId: number) {
  const db = getDb();
  return db.prepare('SELECT * FROM user_reading_progress WHERE user_id = @userId AND book_id = @bookId').get({ userId, bookId }) as {
    user_id: string; book_id: number; progress: number; last_read: string; current_page: number;
  } | undefined;
}

export function setUserReadingProgress(userId: string, bookId: number, progress: number, currentPage = 0) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO user_reading_progress (user_id, book_id, progress, current_page, last_read)
    VALUES (@userId, @bookId, @progress, @currentPage, datetime('now'))
    ON CONFLICT(user_id, book_id) DO UPDATE SET 
      progress = @progress, current_page = @currentPage, last_read = datetime('now')
  `).run({ userId, bookId, progress, currentPage });
}

export function getUserBooksReading(userId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, c.name as category_name, urp.progress as user_progress, urp.last_read as user_last_read
    FROM user_reading_progress urp
    JOIN books b ON b.id = urp.book_id
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE urp.user_id = @userId AND urp.progress > 0 AND urp.progress < 1
    ORDER BY urp.last_read DESC
  `).all({ userId });
}

// ── Affiliate Links ──

export function getAffiliateLinks(bookId: number) {
  const db = getDb();
  return db.prepare('SELECT * FROM affiliate_links WHERE book_id = @bookId ORDER BY platform ASC').all({ bookId });
}

export function upsertAffiliateLink(bookId: number, platform: string, affiliateUrl: string, priceEstimate?: number, currency = 'USD') {
  const db = getDb();
  return db.prepare(`
    INSERT INTO affiliate_links (book_id, platform, affiliate_url, price_estimate, currency)
    VALUES (@bookId, @platform, @affiliateUrl, @priceEstimate, @currency)
    ON CONFLICT(book_id, platform) DO UPDATE SET 
      affiliate_url = @affiliateUrl, price_estimate = @priceEstimate, last_checked = datetime('now')
  `).run({ bookId, platform, affiliateUrl, priceEstimate: priceEstimate ?? null, currency });
}

export function trackAffiliateClick(userId: string | null, linkId: number) {
  const db = getDb();
  return db.prepare('INSERT INTO affiliate_clicks (user_id, link_id) VALUES (@userId, @linkId)').run({ userId, linkId });
}

// ── User Uploads ──

export function getUserUploads(userId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT uu.*, b.title, b.author, b.format
    FROM user_uploads uu
    LEFT JOIN books b ON b.id = uu.book_id
    WHERE uu.user_id = @userId
    ORDER BY uu.uploaded_at DESC
  `).all({ userId });
}

export function countUserUploads(userId: string) {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM user_uploads WHERE user_id = @userId').get({ userId }) as { c: number }).c;
}

export function insertUserUpload(userId: string, bookId: number, originalFilename: string, storagePath: string, fileSize: number, sharedGlobally = false) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO user_uploads (user_id, book_id, original_filename, storage_path, file_size, shared_globally)
    VALUES (@userId, @bookId, @originalFilename, @storagePath, @fileSize, @sharedGlobally)
  `).run({ userId, bookId, originalFilename, storagePath, fileSize, sharedGlobally: sharedGlobally ? 1 : 0 });
}

export function deleteUserUpload(id: number, userId: string) {
  const db = getDb();
  return db.prepare('DELETE FROM user_uploads WHERE id = @id AND user_id = @userId').run({ id, userId });
}
