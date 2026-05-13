-- ══════════════════════════════════════════════════════════
-- BiblioVault AI — Supabase PostgreSQL Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT 'Usuario',
  avatar_url TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'premium', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- ── Books ──
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  description TEXT,
  publisher TEXT,
  published_date TEXT,
  language TEXT,
  page_count INTEGER DEFAULT 0,
  format TEXT DEFAULT 'pdf',
  file_path TEXT,
  file_size INTEGER DEFAULT 0,
  cover_url TEXT,
  category TEXT,
  favorite INTEGER DEFAULT 0,
  reading_progress REAL DEFAULT 0,
  ai_summary TEXT,
  date_added TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  last_read TEXT,
  metadata_source TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ── Categories ──
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Book-Category relationship ──
CREATE TABLE IF NOT EXISTS book_categories (
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

-- ── Collections ──
CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#667eea',
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Collection-Book relationship ──
CREATE TABLE IF NOT EXISTS collection_books (
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection_id, book_id)
);

-- ── Bookmarks ──
CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  label TEXT,
  color TEXT DEFAULT '#667eea',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Reading Sessions ──
CREATE TABLE IF NOT EXISTS reading_sessions (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  start_page INTEGER,
  end_page INTEGER,
  duration_minutes INTEGER,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ── AI Conversations ──
CREATE TABLE IF NOT EXISTS ai_conversations (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ── User Favorites ──
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, book_id)
);

-- ── User Reading Progress ──
CREATE TABLE IF NOT EXISTS user_reading_progress (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  progress REAL DEFAULT 0,
  current_page INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, book_id)
);

-- ── User Uploads ──
CREATE TABLE IF NOT EXISTS user_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  shared_globally INTEGER DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Affiliate Links ──
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

-- ── Affiliate Clicks ──
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_book ON ai_conversations(book_id);
CREATE INDEX IF NOT EXISTS idx_user_uploads_user ON user_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link ON affiliate_clicks(link_id);

-- ── Seed: Default admin user ──
INSERT INTO users (id, email, password_hash, display_name, plan)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@bibliovault.local',
  'PLACEHOLDER_NEEDS_RESET',
  'Administrador',
  'enterprise'
) ON CONFLICT (email) DO NOTHING;

-- ── Enable RLS (Row Level Security) ──
ALTER TABLE user_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reading_progress ENABLE ROW LEVEL SECURITY;

-- Policies: users can only see their own uploads
CREATE POLICY "Users see own uploads" ON user_uploads
  FOR SELECT USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY "Users insert own uploads" ON user_uploads
  FOR INSERT WITH CHECK (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY "Users delete own uploads" ON user_uploads
  FOR DELETE USING (user_id::text = current_setting('app.current_user_id', true));
