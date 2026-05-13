/**
 * Full-Text Search Engine — SQLite FTS5 powered search across book content.
 * Indexes extracted text per-page for fast full-text queries.
 */
import { getDb } from './database.js';
import { extractPdfText } from './textExtractor.js';

// ── Schema ──

export function initFtsSchema() {
  const db = getDb();

  // FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS book_text_fts USING fts5(
      book_id UNINDEXED,
      page UNINDEXED,
      content,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  // Tracking table for indexed status
  db.exec(`
    CREATE TABLE IF NOT EXISTS text_index_status (
      book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      pages_indexed INTEGER DEFAULT 0,
      indexed_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending'
    );
  `);

  console.log('🔍 FTS5 search index initialized');
}

// ── Indexing ──

/** Index a single book's text into FTS5 */
export async function indexBookText(bookId: number, filePath: string): Promise<number> {
  const db = getDb();

  // Skip if already indexed
  const existing = db.prepare('SELECT status FROM text_index_status WHERE book_id = ?').get(bookId) as
    | { status: string }
    | undefined;
  if (existing?.status === 'done') return 0;

  try {
    // Extract all pages
    const result = await extractPdfText(filePath);
    if (!result.pages.length) {
      db.prepare(
        `INSERT OR REPLACE INTO text_index_status (book_id, pages_indexed, status)
         VALUES (?, 0, 'empty')`,
      ).run(bookId);
      return 0;
    }

    // Clear old entries for this book
    db.prepare('DELETE FROM book_text_fts WHERE book_id = ?').run(bookId);

    // Batch insert all pages
    const insert = db.prepare(
      'INSERT INTO book_text_fts (book_id, page, content) VALUES (?, ?, ?)',
    );
    const insertMany = db.transaction((pages: { page: number; text: string }[]) => {
      let count = 0;
      for (const p of pages) {
        const cleaned = p.text.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 10) {
          insert.run(bookId, p.page, cleaned);
          count++;
        }
      }
      return count;
    });

    const indexed = insertMany(result.pages);

    // Update tracking
    db.prepare(
      `INSERT OR REPLACE INTO text_index_status (book_id, pages_indexed, status)
       VALUES (?, ?, 'done')`,
    ).run(bookId, indexed);

    return indexed;
  } catch (err) {
    console.error(`FTS index error for book ${bookId}:`, err);
    db.prepare(
      `INSERT OR REPLACE INTO text_index_status (book_id, pages_indexed, status)
       VALUES (?, 0, 'error')`,
    ).run(bookId);
    return 0;
  }
}

// ── Search ──

export interface SearchResult {
  bookId: number;
  title: string;
  author: string;
  page: number;
  snippet: string;
  format: string;
  coverSource: string;
}

/** Search across all indexed book content */
export function searchFullText(query: string, limit = 50): SearchResult[] {
  const db = getDb();

  // FTS5 match query — handle user input safely
  const ftsQuery = query
    .replace(/[^\w\sáéíóúñü]/gi, '') // Remove special chars
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`)
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    const rows = db
      .prepare(
        `SELECT
          f.book_id,
          b.title,
          b.author,
          f.page,
          snippet(book_text_fts, 2, '<mark>', '</mark>', '...', 40) as snippet,
          b.format,
          b.cover_source
        FROM book_text_fts f
        JOIN books b ON b.id = f.book_id
        WHERE book_text_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
      )
      .all(ftsQuery, limit) as Array<{
      book_id: number;
      title: string;
      author: string;
      page: number;
      snippet: string;
      format: string;
      cover_source: string;
    }>;

    return rows.map((r) => ({
      bookId: r.book_id,
      title: r.title,
      author: r.author,
      page: r.page,
      snippet: r.snippet,
      format: r.format,
      coverSource: r.cover_source,
    }));
  } catch (err) {
    console.error('FTS search error:', err);
    return [];
  }
}

/** Search within a specific book */
export function searchInBook(
  bookId: number,
  query: string,
): { page: number; snippet: string }[] {
  const db = getDb();

  const ftsQuery = query
    .replace(/[^\w\sáéíóúñü]/gi, '')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`)
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    return db
      .prepare(
        `SELECT
          f.page,
          snippet(book_text_fts, 2, '<mark>', '</mark>', '...', 50) as snippet
        FROM book_text_fts f
        WHERE f.book_id = ? AND book_text_fts MATCH ?
        ORDER BY f.page ASC`,
      )
      .all(bookId, ftsQuery) as { page: number; snippet: string }[];
  } catch (err) {
    console.error('In-book search error:', err);
    return [];
  }
}

// ── Batch Indexing ──

interface IndexBatchState {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  errors: number;
  currentBook: string;
}

let batchState: IndexBatchState = {
  status: 'idle',
  total: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  errors: 0,
  currentBook: '',
};

let cancelBatch = false;

export function getIndexBatchState() {
  return { ...batchState };
}

export function cancelIndexBatch() {
  cancelBatch = true;
}

export function resetIndexBatchState() {
  batchState = {
    status: 'idle',
    total: 0,
    processed: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    currentBook: '',
  };
}

export async function runBatchIndexing() {
  if (batchState.status === 'running') return;

  const db = getDb();
  cancelBatch = false;

  // Get all PDF books not yet indexed
  const books = db
    .prepare(
      `SELECT b.id, b.title, b.file_path, b.format
       FROM books b
       LEFT JOIN text_index_status t ON t.book_id = b.id
       WHERE b.format = 'pdf'
         AND (t.status IS NULL OR t.status = 'pending')
       ORDER BY b.id ASC`,
    )
    .all() as Array<{
    id: number;
    title: string;
    file_path: string;
    format: string;
  }>;

  batchState = {
    status: 'running',
    total: books.length,
    processed: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    currentBook: '',
  };

  console.log(`🔍 Starting batch text indexing: ${books.length} books`);

  for (const book of books) {
    if (cancelBatch) {
      batchState.status = 'cancelled';
      console.log('🔍 Batch indexing cancelled');
      return;
    }

    batchState.currentBook = book.title;
    batchState.processed++;

    try {
      const pagesIndexed = await indexBookText(book.id, book.file_path);
      if (pagesIndexed > 0) {
        batchState.indexed++;
      } else {
        batchState.skipped++;
      }
    } catch {
      batchState.errors++;
    }

    // Yield to event loop so the server stays responsive
    await new Promise((r) => setTimeout(r, 50));

    if (batchState.processed % 20 === 0) {
      console.log(
        `🔍 Indexed ${batchState.processed}/${batchState.total} (${batchState.indexed} with text)`,
      );
    }
  }

  batchState.status = 'done';
  batchState.currentBook = '';
  console.log(
    `🔍 Batch indexing complete: ${batchState.indexed} indexed, ${batchState.skipped} empty, ${batchState.errors} errors`,
  );
}

/** Get indexing stats */
export function getIndexStats() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM books WHERE format = \'pdf\'').get() as { c: number }).c;
  const indexed = (
    db.prepare('SELECT COUNT(*) as c FROM text_index_status WHERE status = \'done\'').get() as { c: number }
  ).c;
  const empty = (
    db.prepare('SELECT COUNT(*) as c FROM text_index_status WHERE status = \'empty\'').get() as { c: number }
  ).c;
  const errors = (
    db.prepare('SELECT COUNT(*) as c FROM text_index_status WHERE status = \'error\'').get() as { c: number }
  ).c;

  return { total, indexed, empty, errors, pending: total - indexed - empty - errors };
}
