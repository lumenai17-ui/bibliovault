/**
 * Full-Text Search Engine — Dual backend: SQLite FTS5 / PostgreSQL tsvector.
 * Indexes extracted text per-page for fast full-text queries.
 */

const USE_PG = !!process.env.DATABASE_URL;

// ── Dynamic imports ──
async function getSqliteDb() {
  const { getDb } = await import('./database.js');
  return getDb();
}

async function getPgPool() {
  const { getPgPool } = await import('./pgDatabase.js');
  return getPgPool();
}

// ── Schema ──

export async function initFtsSchema() {
  if (USE_PG) {
    try {
      const pool = await getPgPool();
      
      // Create regular table (no FTS5 in PG)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS book_text_search (
          id SERIAL PRIMARY KEY,
          book_id INTEGER NOT NULL,
          page INTEGER NOT NULL,
          content TEXT NOT NULL,
          content_tsv tsvector
        );
        
        CREATE INDEX IF NOT EXISTS idx_bts_book ON book_text_search(book_id);
        CREATE INDEX IF NOT EXISTS idx_bts_tsv ON book_text_search USING GIN(content_tsv);
      `);

      // Tracking table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS text_index_status (
          book_id INTEGER PRIMARY KEY,
          pages_indexed INTEGER DEFAULT 0,
          indexed_at TIMESTAMPTZ DEFAULT NOW(),
          status TEXT DEFAULT 'pending'
        );
      `);
      
      console.log('Search index initialized (PostgreSQL tsvector)');
    } catch (err) {
      console.error('Failed to init PG search schema:', err);
    }
  } else {
    const db = await getSqliteDb();
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS book_text_fts USING fts5(
        book_id UNINDEXED,
        page UNINDEXED,
        content,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS text_index_status (
        book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        pages_indexed INTEGER DEFAULT 0,
        indexed_at TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'pending'
      );
    `);
    console.log('Search index initialized (SQLite FTS5)');
  }
}

// ── Indexing ──

/** Index a single book's text */
export async function indexBookText(bookId: number, filePath: string): Promise<number> {
  const { extractPdfText } = await import('./textExtractor.js');

  if (USE_PG) {
    const pool = await getPgPool();
    
    // Skip if already indexed
    const existing = await pool.query(
      'SELECT status FROM text_index_status WHERE book_id = $1', [bookId]
    );
    if (existing.rows[0]?.status === 'done') return 0;

    try {
      const result = await extractPdfText(filePath);
      if (!result.pages.length) {
        await pool.query(
          `INSERT INTO text_index_status (book_id, pages_indexed, status)
           VALUES ($1, 0, 'empty')
           ON CONFLICT (book_id) DO UPDATE SET pages_indexed = 0, status = 'empty'`,
          [bookId]
        );
        return 0;
      }

      // Clear old entries
      await pool.query('DELETE FROM book_text_search WHERE book_id = $1', [bookId]);

      // Insert pages with tsvector
      let count = 0;
      for (const p of result.pages) {
        const cleaned = p.text.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 10) {
          await pool.query(
            `INSERT INTO book_text_search (book_id, page, content, content_tsv)
             VALUES ($1, $2, $3, to_tsvector('spanish', $3))`,
            [bookId, p.page, cleaned]
          );
          count++;
        }
      }

      // Update tracking
      await pool.query(
        `INSERT INTO text_index_status (book_id, pages_indexed, status)
         VALUES ($1, $2, 'done')
         ON CONFLICT (book_id) DO UPDATE SET pages_indexed = $2, status = 'done', indexed_at = NOW()`,
        [bookId, count]
      );

      return count;
    } catch (err) {
      console.error(`FTS index error for book ${bookId}:`, err);
      await pool.query(
        `INSERT INTO text_index_status (book_id, pages_indexed, status)
         VALUES ($1, 0, 'error')
         ON CONFLICT (book_id) DO UPDATE SET pages_indexed = 0, status = 'error'`,
        [bookId]
      );
      return 0;
    }
  } else {
    // SQLite FTS5 path
    const db = await getSqliteDb();
    const existing = db.prepare('SELECT status FROM text_index_status WHERE book_id = ?').get(bookId) as
      | { status: string }
      | undefined;
    if (existing?.status === 'done') return 0;

    try {
      const result = await extractPdfText(filePath);
      if (!result.pages.length) {
        db.prepare(
          `INSERT OR REPLACE INTO text_index_status (book_id, pages_indexed, status)
           VALUES (?, 0, 'empty')`,
        ).run(bookId);
        return 0;
      }

      db.prepare('DELETE FROM book_text_fts WHERE book_id = ?').run(bookId);

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
export async function searchFullText(query: string, limit = 50): Promise<SearchResult[]> {
  if (USE_PG) {
    const pool = await getPgPool();
    const sanitized = query.replace(/[^\w\s\u00C0-\u024F]/gi, '').trim();
    if (!sanitized) return [];

    try {
      const rows = await pool.query(`
        SELECT
          f.book_id,
          b.title,
          b.author,
          f.page,
          ts_headline('spanish', f.content, plainto_tsquery('spanish', $1),
            'StartSel=<mark>,StopSel=</mark>,MaxWords=50,MinWords=20') as snippet,
          b.format,
          b.cover_source
        FROM book_text_search f
        JOIN books b ON b.id = f.book_id
        WHERE f.content_tsv @@ plainto_tsquery('spanish', $1)
        ORDER BY ts_rank(f.content_tsv, plainto_tsquery('spanish', $1)) DESC
        LIMIT $2
      `, [sanitized, limit]);

      return rows.rows.map((r: any) => ({
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
  } else {
    const db = await getSqliteDb();
    const ftsQuery = query
      .replace(/[^\w\s\u00C0-\u024F]/gi, '')
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
}

/** Search within a specific book */
export async function searchInBook(
  bookId: number,
  query: string,
): Promise<{ page: number; snippet: string }[]> {
  if (USE_PG) {
    const pool = await getPgPool();
    const sanitized = query.replace(/[^\w\s\u00C0-\u024F]/gi, '').trim();
    if (!sanitized) return [];

    try {
      const rows = await pool.query(`
        SELECT
          f.page,
          ts_headline('spanish', f.content, plainto_tsquery('spanish', $1),
            'StartSel=<mark>,StopSel=</mark>,MaxWords=60,MinWords=20') as snippet
        FROM book_text_search f
        WHERE f.book_id = $2 AND f.content_tsv @@ plainto_tsquery('spanish', $1)
        ORDER BY f.page ASC
      `, [sanitized, bookId]);
      
      return rows.rows.map((r: any) => ({ page: r.page, snippet: r.snippet }));
    } catch (err) {
      console.error('In-book search error:', err);
      return [];
    }
  } else {
    const db = await getSqliteDb();
    const ftsQuery = query
      .replace(/[^\w\s\u00C0-\u024F]/gi, '')
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
  cancelBatch = false;

  let books: Array<{ id: number; title: string; file_path: string; format: string }>;

  if (USE_PG) {
    const pool = await getPgPool();
    const res = await pool.query(`
      SELECT b.id, b.title, b.file_path, b.format
      FROM books b
      LEFT JOIN text_index_status t ON t.book_id = b.id
      WHERE b.format = 'pdf'
        AND (t.status IS NULL OR t.status = 'pending')
      ORDER BY b.id ASC
    `);
    books = res.rows;
  } else {
    const db = await getSqliteDb();
    books = db
      .prepare(
        `SELECT b.id, b.title, b.file_path, b.format
         FROM books b
         LEFT JOIN text_index_status t ON t.book_id = b.id
         WHERE b.format = 'pdf'
           AND (t.status IS NULL OR t.status = 'pending')
         ORDER BY b.id ASC`,
      )
      .all() as typeof books;
  }

  batchState = {
    status: 'running',
    total: books.length,
    processed: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    currentBook: '',
  };

  console.log(`Starting batch text indexing: ${books.length} books`);

  for (const book of books) {
    if (cancelBatch) {
      batchState.status = 'cancelled';
      console.log('Batch indexing cancelled');
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

    await new Promise((r) => setTimeout(r, 50));

    if (batchState.processed % 20 === 0) {
      console.log(
        `Indexed ${batchState.processed}/${batchState.total} (${batchState.indexed} with text)`,
      );
    }
  }

  batchState.status = 'done';
  batchState.currentBook = '';
  console.log(
    `Batch indexing complete: ${batchState.indexed} indexed, ${batchState.skipped} empty, ${batchState.errors} errors`,
  );
}

/** Get indexing stats */
export async function getIndexStats() {
  if (USE_PG) {
    const pool = await getPgPool();
    const [total, indexed, empty, errors] = await Promise.all([
      pool.query("SELECT COUNT(*) as c FROM books WHERE format = 'pdf'"),
      pool.query("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'done'"),
      pool.query("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'empty'"),
      pool.query("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'error'"),
    ]);
    const t = parseInt(total.rows[0].c);
    const i = parseInt(indexed.rows[0].c);
    const e = parseInt(empty.rows[0].c);
    const err = parseInt(errors.rows[0].c);
    return { total: t, indexed: i, empty: e, errors: err, pending: t - i - e - err };
  } else {
    const db = await getSqliteDb();
    const total = (db.prepare("SELECT COUNT(*) as c FROM books WHERE format = 'pdf'").get() as { c: number }).c;
    const indexed = (db.prepare("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'done'").get() as { c: number }).c;
    const empty = (db.prepare("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'empty'").get() as { c: number }).c;
    const errors = (db.prepare("SELECT COUNT(*) as c FROM text_index_status WHERE status = 'error'").get() as { c: number }).c;
    return { total, indexed, empty, errors, pending: total - indexed - empty - errors };
  }
}
