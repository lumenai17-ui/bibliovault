/**
 * BiblioVault AI — PostgreSQL Database Layer
 * Uses the `pg` (node-postgres) driver with DATABASE_URL from Supabase.
 * 
 * This module mirrors the API of database.ts (SQLite) so that
 * index.ts can work with either backend seamlessly.
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
  }
  return pool;
}

/** Test connection */
export async function testPgConnection(): Promise<boolean> {
  try {
    const p = getPgPool();
    const res = await p.query('SELECT NOW()');
    console.log('🐘 PostgreSQL connected:', res.rows[0].now);
    return true;
  } catch (err) {
    console.error('🐘 PostgreSQL connection failed:', err);
    return false;
  }
}

/** Initialize the PostgreSQL schema (idempotent) */
export async function initPgSchema(): Promise<void> {
  const p = getPgPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id),
      ai_suggested INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
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
      date_added TIMESTAMPTZ DEFAULT NOW(),
      last_read TIMESTAMPTZ,
      reading_progress REAL DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      ocr_status TEXT DEFAULT 'none',
      ai_summary TEXT,
      folder_category TEXT DEFAULT '',
      enriched INTEGER DEFAULT 0,
      original_title TEXT DEFAULT '',
      cover_source TEXT DEFAULT 'svg',
      enrichment_source TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id SERIAL PRIMARY KEY,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      position TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id SERIAL PRIMARY KEY,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      messages TEXT DEFAULT '[]',
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id SERIAL PRIMARY KEY,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      label TEXT DEFAULT '',
      color TEXT DEFAULT '#667eea',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#667eea',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS book_collections (
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (book_id, collection_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      plan TEXT DEFAULT 'free',
      avatar_url TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      preferences JSONB DEFAULT '{}',
      paypal_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'none',
      subscription_start TIMESTAMPTZ,
      subscription_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS user_reading_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      progress REAL DEFAULT 0,
      last_read TIMESTAMPTZ DEFAULT NOW(),
      current_page INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS user_uploads (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      shared_globally INTEGER DEFAULT 0,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS affiliate_links (
      id SERIAL PRIMARY KEY,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      price_estimate REAL,
      currency TEXT DEFAULT 'USD',
      last_checked TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (book_id, platform)
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
      clicked_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS communities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      rules TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      type TEXT DEFAULT 'public',
      book_id INTEGER REFERENCES books(id),
      created_by TEXT REFERENCES users(id),
      member_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_members (
      community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (community_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned BOOLEAN DEFAULT false,
      locked BOOLEAN DEFAULT false,
      has_spoilers BOOLEAN DEFAULT false,
      upvotes INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      last_activity TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS replies (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
      parent_reply_id INTEGER REFERENCES replies(id),
      user_id TEXT REFERENCES users(id),
      content TEXT NOT NULL,
      upvotes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      edited_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS votes (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      value INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS community_books (
      community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      recommended_by TEXT REFERENCES users(id),
      note TEXT DEFAULT '',
      added_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (community_id, book_id)
    );

    -- Payment & Subscription tables (Phase 14)
    CREATE TABLE IF NOT EXISTS payment_history (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      paypal_payment_id TEXT,
      amount DECIMAL(10,2),
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'completed',
      coupon_code TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_percent INTEGER NOT NULL,
      max_uses INTEGER DEFAULT 100,
      current_uses INTEGER DEFAULT 0,
      valid_from TIMESTAMPTZ DEFAULT NOW(),
      valid_until TIMESTAMPTZ,
      created_by TEXT REFERENCES users(id),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Create indexes
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_books_format ON books(format);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_id);
    CREATE INDEX IF NOT EXISTS idx_books_favorite ON books(favorite);
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
    CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_progress_user ON user_reading_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_uploads_user ON user_uploads(user_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_links_book ON affiliate_links(book_id);
    CREATE INDEX IF NOT EXISTS idx_communities_book ON communities(book_id);
    CREATE INDEX IF NOT EXISTS idx_communities_slug ON communities(slug);
    CREATE INDEX IF NOT EXISTS idx_threads_community ON threads(community_id);
    CREATE INDEX IF NOT EXISTS idx_threads_activity ON threads(last_activity DESC);
    CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id);
    CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);
  `);

  // Seed default admin user
  await p.query(`
    INSERT INTO users (id, email, password_hash, display_name, plan)
    VALUES ('00000000-0000-0000-0000-000000000001', 'admin@bibliovault.local', 'PLACEHOLDER_NEEDS_RESET', 'Administrador', 'enterprise')
    ON CONFLICT (email) DO NOTHING
  `);

  // Seed default categories
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

  for (const cat of defaultCategories) {
    await p.query(
      'INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [cat],
    );
  }

  console.log('🐘 PostgreSQL schema initialized');

  // Phase 15.5: Add uploaded_by + visibility columns for user uploads
  await p.query(`
    ALTER TABLE books ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';
    ALTER TABLE books ADD COLUMN IF NOT EXISTS r2_file_key TEXT;
  `).catch(() => {});
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_books_uploaded_by ON books(uploaded_by);
    CREATE INDEX IF NOT EXISTS idx_books_visibility ON books(visibility);
  `).catch(() => {});

  // Phase 16: Admin activity log
  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_log (
      id SERIAL PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(() => {});

  // Ensure subscription_id column exists (subscription code uses this name)
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT`).catch(() => {});

  // Fix orphaned user_uploads: link them to books where uploaded_by was not set
  await p.query(`
    UPDATE books SET uploaded_by = uu.user_id, visibility = 'private'
    FROM user_uploads uu
    WHERE books.id = uu.book_id AND books.uploaded_by IS NULL AND uu.book_id IS NOT NULL
  `).catch(() => {});
}

// ══════════════════════════════════════
//  CRUD Operations (PostgreSQL versions)
// ══════════════════════════════════════

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

export async function pgInsertBook(book: Omit<BookRow, 'id' | 'date_added'>) {
  const p = getPgPool();
  return p.query(`
    INSERT INTO books (
      title, author, description, isbn, language, pages,
      format, content_type, file_path, file_name, file_size, cover_path,
      category_id, subcategory, tags, favorite, ocr_status, ai_summary, folder_category
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    ) ON CONFLICT (file_path) DO NOTHING
  `, [
    book.title, book.author, book.description, book.isbn, book.language, book.pages,
    book.format, book.content_type, book.file_path, book.file_name, book.file_size, book.cover_path,
    book.category_id, book.subcategory, book.tags, book.favorite, book.ocr_status, book.ai_summary, book.folder_category,
  ]);
}

/** Insert a user-uploaded book and return its ID */
export async function pgInsertUserBook(book: {
  title: string;
  format: string;
  file_path: string;
  file_name: string;
  file_size: number;
  r2_file_key: string;
  uploaded_by: string;
  visibility: string;
  category_id?: number;
}): Promise<number> {
  const p = getPgPool();
  const res = await p.query(`
    INSERT INTO books (
      title, author, description, format, content_type,
      file_path, file_name, file_size, r2_file_key,
      uploaded_by, visibility, category_id, folder_category
    ) VALUES (
      $1, '', '', $2, 'text',
      $3, $4, $5, $6,
      $7, $8, $9, 'Mis Libros'
    ) RETURNING id
  `, [
    book.title, book.format, book.file_path, book.file_name, book.file_size,
    book.r2_file_key, book.uploaded_by, book.visibility, book.category_id || null,
  ]);
  return res.rows[0].id;
}

export async function pgGetAllBooks(limit = 2000, offset = 0, filters?: {
  format?: string;
  category_id?: number;
  favorite?: boolean;
  search?: string;
  collection_id?: number;
  userId?: string;
}) {
  const p = getPgPool();
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let paramIndex = 1;

  // Visibility filter: show public books + user's own private uploads
  if (filters?.userId) {
    where += ` AND (b.visibility = 'public' OR b.visibility IS NULL OR b.uploaded_by = $${paramIndex++})`;
    params.push(filters.userId);
  } else {
    where += ` AND (b.visibility = 'public' OR b.visibility IS NULL)`;
  }

  if (filters?.format && filters.format !== 'all') {
    where += ` AND b.format = $${paramIndex++}`;
    params.push(filters.format);
  }
  if (filters?.category_id) {
    where += ` AND b.category_id = $${paramIndex++}`;
    params.push(filters.category_id);
  }
  if (filters?.favorite) {
    where += ' AND b.favorite = 1';
  }
  if (filters?.search) {
    where += ` AND (b.title ILIKE $${paramIndex} OR b.author ILIKE $${paramIndex} OR b.folder_category ILIKE $${paramIndex})`;
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  const joinCollections = filters?.collection_id
    ? `JOIN book_collections bc ON bc.book_id = b.id AND bc.collection_id = $${paramIndex++}`
    : '';
  if (filters?.collection_id) params.push(filters.collection_id);

  const limitIdx = paramIndex++;
  const offsetIdx = paramIndex++;
  params.push(limit, offset);

  const query = `
    SELECT b.*, c.name as category_name
    FROM books b
    LEFT JOIN categories c ON b.category_id = c.id
    ${joinCollections}
    ${where}
    ORDER BY b.title ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countQuery = `SELECT COUNT(*) as count FROM books b ${joinCollections} ${where}`;

  const [rows, total] = await Promise.all([
    p.query(query, params),
    p.query(countQuery, params.slice(0, params.length - 2)), // without limit/offset
  ]);

  return { books: rows.rows, total: parseInt(total.rows[0].count) };
}

export async function pgGetBookById(id: number) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.*, c.name as category_name
    FROM books b
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.id = $1
  `, [id]);
  return res.rows[0] || null;
}

export async function pgUpdateBook(id: number, updates: Partial<BookRow>) {
  const p = getPgPool();
  const keys = Object.keys(updates).filter(k => k !== 'id');
  if (keys.length === 0) return;

  // If title is changing, clear the AI summary so it regenerates
  if (updates.title) {
    updates.ai_summary = null as any;
    if (!keys.includes('ai_summary')) keys.push('ai_summary');
  }

  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => (updates as any)[k]);
  values.push(id);

  return p.query(`UPDATE books SET ${setClauses} WHERE id = $${values.length}`, values);
}

export async function pgGetCategories() {
  const p = getPgPool();
  const res = await p.query(`
    SELECT c.*, COUNT(b.id) as book_count
    FROM categories c
    LEFT JOIN books b ON b.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  return res.rows;
}

export async function pgGetStats() {
  const p = getPgPool();
  const [total, favorites, reading, byFormat, categories] = await Promise.all([
    p.query('SELECT COUNT(*) as c FROM books'),
    p.query('SELECT COUNT(*) as c FROM books WHERE favorite = 1'),
    p.query('SELECT COUNT(*) as c FROM books WHERE reading_progress > 0 AND reading_progress < 1'),
    p.query('SELECT format, COUNT(*) as c FROM books GROUP BY format'),
    p.query('SELECT COUNT(*) as c FROM categories'),
  ]);

  return {
    total: parseInt(total.rows[0].c),
    favorites: parseInt(favorites.rows[0].c),
    reading: parseInt(reading.rows[0].c),
    categories: parseInt(categories.rows[0].c),
    byFormat: Object.fromEntries(byFormat.rows.map((r: any) => [r.format, parseInt(r.c)])),
  };
}

export async function pgGetCategoryByName(name: string) {
  const p = getPgPool();
  const res = await p.query('SELECT id FROM categories WHERE name = $1', [name]);
  return res.rows[0] || undefined;
}

export async function pgBookExistsByPath(filePath: string): Promise<boolean> {
  const p = getPgPool();
  const res = await p.query('SELECT id FROM books WHERE file_path = $1', [filePath]);
  return res.rows.length > 0;
}

export async function pgGetBooksWithoutCovers(limit = 2000) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT id, title, file_name, file_path, format, cover_source
    FROM books
    WHERE cover_source = 'svg' OR cover_source IS NULL OR cover_source = ''
    ORDER BY id ASC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

export async function pgGetUnenrichedBooks(limit = 2000) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT id, title, author, file_name, file_path, format, enriched
    FROM books
    WHERE enriched = 0 OR enriched IS NULL
    ORDER BY id ASC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

// ── Collections ──

export async function pgGetCollections() {
  const p = getPgPool();
  const res = await p.query(`
    SELECT c.*, COUNT(bc.book_id) as book_count
    FROM collections c
    LEFT JOIN book_collections bc ON bc.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  return res.rows;
}

export async function pgCreateCollection(name: string, description = '', color = '#667eea') {
  const p = getPgPool();
  const res = await p.query(
    'INSERT INTO collections (name, description, color) VALUES ($1, $2, $3) RETURNING id',
    [name, description, color],
  );
  return res.rows[0].id;
}

export async function pgUpdateCollection(id: number, name: string, description: string, color: string) {
  const p = getPgPool();
  return p.query('UPDATE collections SET name = $1, description = $2, color = $3 WHERE id = $4', [name, description, color, id]);
}

export async function pgDeleteCollection(id: number) {
  const p = getPgPool();
  return p.query('DELETE FROM collections WHERE id = $1', [id]);
}

export async function pgAddBookToCollection(bookId: number, collectionId: number) {
  const p = getPgPool();
  return p.query('INSERT INTO book_collections (book_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [bookId, collectionId]);
}

export async function pgRemoveBookFromCollection(bookId: number, collectionId: number) {
  const p = getPgPool();
  return p.query('DELETE FROM book_collections WHERE book_id = $1 AND collection_id = $2', [bookId, collectionId]);
}

export async function pgGetBookCollections(bookId: number) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT c.*
    FROM collections c
    JOIN book_collections bc ON bc.collection_id = c.id
    WHERE bc.book_id = $1
  `, [bookId]);
  return res.rows;
}

// ── Users ──

export async function pgGetUserById(id: string) {
  const p = getPgPool();
  const res = await p.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] || undefined;
}

export async function pgGetUserByEmail(email: string) {
  const p = getPgPool();
  const res = await p.query('SELECT * FROM users WHERE email = $1', [email]);
  return res.rows[0] || undefined;
}

export async function pgCreateUser(id: string, email: string, passwordHash: string, displayName: string) {
  const p = getPgPool();
  return p.query(
    'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
    [id, email, passwordHash, displayName],
  );
}

export async function pgUpdateUser(id: string, updates: Record<string, string>) {
  const p = getPgPool();
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => updates[k]);
  values.push(id);
  return p.query(`UPDATE users SET ${setClauses} WHERE id = $${values.length}`, values);
}

export async function pgUpdateUserPassword(id: string, passwordHash: string) {
  const p = getPgPool();
  return p.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
}

export async function pgUpdateLastLogin(id: string) {
  const p = getPgPool();
  return p.query('UPDATE users SET last_login = NOW() WHERE id = $1', [id]);
}

// ── User Favorites ──

export async function pgGetUserFavorites(userId: string) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.*, c.name as category_name
    FROM user_favorites uf
    JOIN books b ON b.id = uf.book_id
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE uf.user_id = $1
    ORDER BY uf.created_at DESC
  `, [userId]);
  return res.rows;
}

export async function pgIsUserFavorite(userId: string, bookId: number) {
  const p = getPgPool();
  const res = await p.query('SELECT 1 FROM user_favorites WHERE user_id = $1 AND book_id = $2', [userId, bookId]);
  return res.rows.length > 0;
}

export async function pgAddUserFavorite(userId: string, bookId: number) {
  const p = getPgPool();
  return p.query('INSERT INTO user_favorites (user_id, book_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, bookId]);
}

export async function pgRemoveUserFavorite(userId: string, bookId: number) {
  const p = getPgPool();
  return p.query('DELETE FROM user_favorites WHERE user_id = $1 AND book_id = $2', [userId, bookId]);
}

export async function pgCountUserFavorites(userId: string) {
  const p = getPgPool();
  const res = await p.query('SELECT COUNT(*) as c FROM user_favorites WHERE user_id = $1', [userId]);
  return parseInt(res.rows[0].c);
}

// ── User Reading Progress ──

export async function pgGetUserReadingProgress(userId: string, bookId: number) {
  const p = getPgPool();
  const res = await p.query('SELECT * FROM user_reading_progress WHERE user_id = $1 AND book_id = $2', [userId, bookId]);
  return res.rows[0] || undefined;
}

export async function pgSetUserReadingProgress(userId: string, bookId: number, progress: number, currentPage = 0) {
  const p = getPgPool();
  return p.query(`
    INSERT INTO user_reading_progress (user_id, book_id, progress, current_page, last_read)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id, book_id) DO UPDATE SET
      progress = $3, current_page = $4, last_read = NOW()
  `, [userId, bookId, progress, currentPage]);
}

export async function pgGetUserBooksReading(userId: string) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.*, c.name as category_name, urp.progress as user_progress, urp.last_read as user_last_read
    FROM user_reading_progress urp
    JOIN books b ON b.id = urp.book_id
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE urp.user_id = $1 AND urp.progress > 0 AND urp.progress < 1
    ORDER BY urp.last_read DESC
  `, [userId]);
  return res.rows;
}

// ── Affiliates ──

export async function pgGetAffiliateLinks(bookId: number) {
  const p = getPgPool();
  const res = await p.query('SELECT * FROM affiliate_links WHERE book_id = $1 ORDER BY platform ASC', [bookId]);
  return res.rows;
}

export async function pgUpsertAffiliateLink(bookId: number, platform: string, affiliateUrl: string, priceEstimate?: number, currency = 'USD') {
  const p = getPgPool();
  return p.query(`
    INSERT INTO affiliate_links (book_id, platform, affiliate_url, price_estimate, currency)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (book_id, platform) DO UPDATE SET
      affiliate_url = $3, price_estimate = $4, last_checked = NOW()
  `, [bookId, platform, affiliateUrl, priceEstimate ?? null, currency]);
}

export async function pgTrackAffiliateClick(userId: string | null, linkId: number) {
  const p = getPgPool();
  return p.query('INSERT INTO affiliate_clicks (user_id, link_id) VALUES ($1, $2)', [userId, linkId]);
}

// ── User Uploads ──

export async function pgGetUserUploads(userId: string) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT uu.*, b.title, b.author, b.format, b.visibility
    FROM user_uploads uu
    LEFT JOIN books b ON b.id = uu.book_id
    WHERE uu.user_id = $1
    ORDER BY uu.uploaded_at DESC
  `, [userId]);
  return res.rows;
}

export async function pgCountUserUploads(userId: string) {
  const p = getPgPool();
  const res = await p.query('SELECT COUNT(*) as c FROM user_uploads WHERE user_id = $1', [userId]);
  return parseInt(res.rows[0].c);
}

export async function pgInsertUserUpload(userId: string, bookId: number | null, originalFilename: string, storagePath: string, fileSize: number, sharedGlobally = false) {
  const p = getPgPool();
  return p.query(`
    INSERT INTO user_uploads (user_id, book_id, original_filename, storage_path, file_size, shared_globally)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, bookId, originalFilename, storagePath, fileSize, sharedGlobally ? 1 : 0]);
}

export async function pgDeleteUserUpload(id: number, userId: string) {
  const p = getPgPool();
  return p.query('DELETE FROM user_uploads WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ══════════════════════════════════════
//  Admin Queries (Phase 16)
// ══════════════════════════════════════

/** Dashboard aggregate stats */
export async function pgGetDashboardStats() {
  const p = getPgPool();
  const [users, books, active, pending, uploads] = await Promise.all([
    p.query('SELECT COUNT(*) as c FROM users'),
    p.query("SELECT COUNT(*) as c FROM books WHERE visibility IS NULL OR visibility = 'public'"),
    p.query("SELECT COUNT(*) as c FROM users WHERE subscription_status = 'active'"),
    p.query("SELECT COUNT(*) as c FROM books WHERE visibility = 'pending'"),
    p.query('SELECT COUNT(*) as c FROM user_uploads'),
  ]);
  const activeCount = parseInt(active.rows[0].c);
  return {
    totalUsers: parseInt(users.rows[0].c),
    totalBooks: parseInt(books.rows[0].c),
    activeSubscriptions: activeCount,
    pendingBooks: parseInt(pending.rows[0].c),
    totalUploads: parseInt(uploads.rows[0].c),
    estimatedRevenue: activeCount * 12.99,
  };
}

/** All users for admin table */
export async function pgGetAllUsersAdmin(search?: string) {
  const p = getPgPool();
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (search) {
    where += ` AND (u.email ILIKE $${idx} OR u.display_name ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  const res = await p.query(`
    SELECT u.id, u.email, u.display_name, u.plan,
           u.subscription_status, u.subscription_end,
           u.subscription_id,
           u.created_at, u.last_login,
           COALESCE(uc.cnt, 0) as upload_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM user_uploads GROUP BY user_id) uc ON uc.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
  `, params);
  return res.rows;
}

/** Books pending admin approval */
export async function pgGetPendingBooks() {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.id, b.title, b.format, b.file_size, b.date_added,
           b.uploaded_by, b.visibility, b.category_id,
           u.email as uploader_email, u.display_name as uploader_name
    FROM books b
    LEFT JOIN users u ON u.id = b.uploaded_by
    WHERE b.visibility = 'pending'
    ORDER BY b.date_added DESC
  `);
  return res.rows;
}

/** Books uploaded by a specific user */
export async function pgGetUserBooks(userId: string) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.id, b.title, b.format, b.file_size, b.date_added,
           b.cover_path, b.visibility, b.category_id,
           c.name as category_name
    FROM books b
    LEFT JOIN categories c ON c.id = b.category_id
    WHERE b.uploaded_by = $1
    ORDER BY b.date_added DESC
  `, [userId]);
  return res.rows;
}

/** Recently registered users (for dashboard) */
export async function pgGetRecentUsers(limit = 5) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT id, email, display_name, plan, created_at
    FROM users ORDER BY created_at DESC LIMIT $1
  `, [limit]);
  return res.rows;
}

/** Recently uploaded books (for dashboard) */
export async function pgGetRecentUploads(limit = 5) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT b.id, b.title, b.format, b.visibility, b.date_added,
           u.email as uploader_email
    FROM books b
    LEFT JOIN users u ON u.id = b.uploaded_by
    WHERE b.uploaded_by IS NOT NULL
    ORDER BY b.date_added DESC LIMIT $1
  `, [limit]);
  return res.rows;
}

/** Log an admin action */
export async function pgLogAdminAction(adminId: string, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  const p = getPgPool();
  await p.query(`
    INSERT INTO admin_log (admin_id, action, target_type, target_id, details)
    VALUES ($1, $2, $3, $4, $5)
  `, [adminId, action, targetType, targetId, JSON.stringify(details)]).catch(() => {});
}

/** Get admin activity log */
export async function pgGetAdminLog(limit = 50) {
  const p = getPgPool();
  const res = await p.query(`
    SELECT al.*, u.email as admin_email
    FROM admin_log al
    LEFT JOIN users u ON u.id = al.admin_id
    ORDER BY al.created_at DESC LIMIT $1
  `, [limit]);
  return res.rows;
}

/** Delete a user and their data */
export async function pgDeleteUser(userId: string) {
  const p = getPgPool();
  // Delete user uploads, favorites, reading progress, then user
  await p.query('DELETE FROM user_uploads WHERE user_id = $1', [userId]);
  await p.query('DELETE FROM user_favorites WHERE user_id = $1', [userId]);
  await p.query('DELETE FROM user_reading_progress WHERE user_id = $1', [userId]).catch(() => {});
  // Mark their uploaded books as orphaned (don't delete the books)
  await p.query("UPDATE books SET uploaded_by = NULL, visibility = 'public' WHERE uploaded_by = $1", [userId]);
  // Delete user
  await p.query('DELETE FROM users WHERE id = $1', [userId]);
}

/** Admin edit user fields */
export async function pgAdminEditUser(userId: string, fields: { display_name?: string; email?: string }) {
  const p = getPgPool();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (fields.display_name !== undefined) { sets.push(`display_name = $${i++}`); vals.push(fields.display_name); }
  if (fields.email !== undefined) { sets.push(`email = $${i++}`); vals.push(fields.email); }
  if (sets.length === 0) return;
  vals.push(userId);
  await p.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}
