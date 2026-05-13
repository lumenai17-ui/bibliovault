import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  getDb,
  getAllBooks,
  getBookById,
  updateBook,
  getCategories,
  getStats,
  getUnenrichedBooks,
  getBooksWithoutCovers,
} from './database.js';
import { scanLibrary, type ScanProgress } from './scanner.js';
import { streamChat, checkHermesHealth, llmComplete, streamOrganizerChat } from './hermes.js';
import { extractPdfText, extractBookExcerpt, isPdfTextBased } from './textExtractor.js';
import { generateCover, COVERS_DIR } from './coverGenerator.js';
import { enrichBook, runBatchEnrichment, getBatchState, cancelBatchEnrichment, resetBatchState } from './metadataEnricher.js';
import { extractPdfCover, extractImageCover, runBatchCoverExtraction, getCoverBatchState, cancelCoverBatchJob, resetCoverBatchState } from './pdfCoverExtractor.js';
import { identifyTitleFromPdf } from './aiTitleIdentifier.js';
import { searchWeb, formatSearchResults } from './webSearch.js';
import {
  initFtsSchema,
  searchFullText,
  searchInBook,
  runBatchIndexing,
  getIndexBatchState,
  cancelIndexBatch,
  resetIndexBatchState,
  getIndexStats,
  indexBookText,
} from './searchEngine.js';
import cookieParser from 'cookie-parser';
import {
  registerUser,
  loginUser,
  getAuthenticatedUser,
  COOKIE_NAME,
  getSessionCookieOptions,
} from './auth.js';
import { requireAuth, optionalAuth } from './middleware/requireAuth.js';
import { getUserById, updateUser } from './database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const LIBRARY_PATH = process.env.LIBRARY_PATH || 'C:\\Users\\Usuario\\OneDrive\\Documentos\\Lectura';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve static covers
app.use('/covers', express.static(COVERS_DIR));

// Initialize database on startup
getDb();
initFtsSchema();
console.log('📦 Database initialized');

// Sync cover paths on startup — update DB to prefer API covers over SVG
(function syncCoverPaths() {
  const db = getDb();
  const books = db.prepare('SELECT id, cover_path, cover_source FROM books').all() as Array<{
    id: number; cover_path: string; cover_source: string;
  }>;
  let updated = 0;
  for (const book of books) {
    // Check for API-downloaded covers
    const jpgPath = join(COVERS_DIR, `${book.id}.jpg`);
    const pngPath = join(COVERS_DIR, `${book.id}.png`);
    const pdfJpgPath = join(COVERS_DIR, `${book.id}_pdf.jpg`);

    if (existsSync(jpgPath) && book.cover_path !== jpgPath) {
      updateBook(book.id, { cover_path: jpgPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pngPath) && book.cover_path !== pngPath) {
      updateBook(book.id, { cover_path: pngPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pdfJpgPath) && book.cover_path !== pdfJpgPath && book.cover_source !== 'api') {
      updateBook(book.id, { cover_path: pdfJpgPath, cover_source: 'pdf' } as any);
      updated++;
    }
  }
  if (updated > 0) console.log(`🖼️  Cover sync: updated ${updated} book cover paths`);
})();

// ── Scan state ──
let currentScan: ScanProgress | null = null;
let scanRunning = false;

// ══════════════════════════════════════
//  API Routes
// ══════════════════════════════════════

// ── Authentication ──

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const result = await registerUser(email, password, displayName || '');
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token!, getSessionCookieOptions());
    res.json({ user: result.user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error al registrar usuario.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token!, getSessionCookieOptions());
    res.json({ user: result.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  
  const user = getAuthenticatedUser(token);
  if (!user) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Sesión inválida.' });
  }

  res.json({ user });
});

app.put('/api/auth/me', requireAuth, (req, res) => {
  try {
    const { displayName, avatar_url } = req.body;
    const updates: Record<string, string> = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    
    updateUser(req.userId!, updates as any);
    const user = getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Error al actualizar perfil.' });
  }
});

// ── Books ──
app.get('/api/books', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 200;
  const offset = parseInt(req.query.offset as string) || 0;
  const format = req.query.format as string | undefined;
  const category_id = req.query.category_id ? parseInt(req.query.category_id as string) : undefined;
  const favorite = req.query.favorite === 'true' ? true : undefined;
  const search = req.query.search as string | undefined;
  const collection_id = req.query.collection_id ? parseInt(req.query.collection_id as string) : undefined;

  const result = getAllBooks(limit, offset, { format, category_id, favorite, search, collection_id });
  res.json(result);
});

app.get('/api/books/:id', (req, res) => {
  const book = getBookById(parseInt(req.params.id));
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});

app.patch('/api/books/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const allowed = [
    'favorite', 'reading_progress', 'last_read', 'category_id',
    'tags', 'subcategory', 'ai_summary', 'cover_path', 'cover_source',
    'title', 'author', 'description', 'isbn', 'pages',
    'enriched', 'original_title', 'enrichment_source',
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updateBook(id, updates);
  res.json({ ok: true });
});

// ── Extract HTML from DOC/DOCX for Web Reader ──
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

app.get('/api/books/:id/html', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  const filePath = book.file_path as string;

  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  
  try {
    if (ext === 'docx') {
      const result = await mammoth.convertToHtml({ path: filePath });
      return res.send(result.value);
    } else if (ext === 'doc') {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      const text = extracted.getBody();
      // Simple text to HTML paragraphs conversion
      const html = text.split(/\n\s*\n/)
        .filter(p => p.trim().length > 0)
        .map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('');
      return res.send(html);
    } else {
      return res.status(400).json({ error: 'Not a DOC or DOCX file' });
    }
  } catch (err) {
    console.error('Error extracting HTML from doc:', err);
    res.status(500).json({ error: 'Failed to extract document' });
  }
});

// ── Serve book files for the reader ──
app.get('/api/books/:id/file', (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  const filePath = book.file_path as string;

  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    bmp: 'image/bmp',
  };

  res.setHeader('Content-Type', mimeMap[ext || ''] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${book.file_name}"`);
  res.sendFile(filePath);
});

// ── Cover serving (supports JPG from API/PDF and SVG fallback) ──
app.get('/api/books/:id/cover', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const serveImage = (path: string) => {
    const content = readFileSync(path);
    const isSvg = path.endsWith('.svg');
    const isPng = path.endsWith('.png');
    const contentType = isSvg ? 'image/svg+xml' : isPng ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    // Use no-cache so browser always revalidates (but can use ETag for 304)
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(content);
  };

  // 1. Check existing cover_path (could be API jpg, PDF jpg, or SVG)
  const coverPath = book.cover_path as string;
  if (coverPath && existsSync(coverPath)) {
    return serveImage(coverPath);
  }

  // 2. Check if a downloaded API cover exists
  const jpgPath = join(COVERS_DIR, `${bookId}.jpg`);
  const pngPath = join(COVERS_DIR, `${bookId}.png`);
  if (existsSync(jpgPath)) {
    updateBook(bookId, { cover_path: jpgPath, cover_source: 'api' } as any);
    return serveImage(jpgPath);
  }
  if (existsSync(pngPath)) {
    updateBook(bookId, { cover_path: pngPath, cover_source: 'api' } as any);
    return serveImage(pngPath);
  }

  // 3. Check if a PDF-extracted cover exists
  const pdfCoverPath = join(COVERS_DIR, `${bookId}_pdf.jpg`);
  if (existsSync(pdfCoverPath)) {
    updateBook(bookId, { cover_path: pdfCoverPath, cover_source: 'pdf' } as any);
    return serveImage(pdfCoverPath);
  }

  // 4. Generate SVG fallback
  const filePath = book.file_path as string;
  try {
    const newCoverPath = await generateCover(
      bookId, filePath, book.title as string, book.author as string,
    );
    if (newCoverPath && existsSync(newCoverPath)) {
      updateBook(bookId, { cover_path: newCoverPath, cover_source: 'svg' } as any);
      return serveImage(newCoverPath);
    }
  } catch (err) {
    console.error('Cover generation failed:', err);
  }

  res.status(204).end();
});

// ── Text Extraction ──
app.get('/api/books/:id/text', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const filePath = book.file_path as string;
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const startPage = req.query.start ? parseInt(req.query.start as string) : undefined;
  const endPage = req.query.end ? parseInt(req.query.end as string) : undefined;

  const result = await extractPdfText(filePath, startPage, endPage);
  res.json(result);
});

// ── AI Summary Generation ──
app.post('/api/books/:id/summary', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const forceOcr = req.query.ocr === 'true';

  // Check if summary already exists (and we are not forcing a refresh)
  if (book.ai_summary && req.query.refresh !== 'true') {
    return res.json({ summary: book.ai_summary, cached: true });
  }

  const filePath = book.file_path as string;
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    let excerpt = '';

    if (forceOcr) {
      console.log(`👁️ Forcing OCR extraction for summary of "${book.title}"`);
      const { extractOcrText } = await import('./ocrExtractor.js');
      excerpt = await extractOcrText(filePath, 4);
    } else {
      // Normal extraction
      excerpt = await extractBookExcerpt(filePath, 3000);
      
      // Fallback to OCR if empty
      if (!excerpt || excerpt.length < 50) {
        console.log(`⚠️ Book "${book.title}" seems to be scanned. Running OCR for summary...`);
        try {
          const { extractOcrText } = await import('./ocrExtractor.js');
          excerpt = await extractOcrText(filePath, 4);
        } catch (ocrErr) {
          console.error('OCR fallback failed for summary:', ocrErr);
        }
      }
    }
    
    if (!excerpt || excerpt.length < 50) {
      return res.json({ summary: 'Este libro parece ser un escaneo de imágenes. No se pudo leer el texto ni siquiera con OCR.', cached: false });
    }

    // Ask LLM (Groq or Hermes) for a summary
    const llmOnline = await checkHermesHealth();
    if (!llmOnline) {
      return res.status(503).json({ error: 'AI no está disponible (ni Groq ni Hermes)' });
    }

    const summary = await llmComplete(
      'Eres un bibliotecario experto. Genera resúmenes concisos y útiles de libros. Responde en español. El resumen debe tener 2-3 párrafos máximo.',
      `Genera un resumen del siguiente libro titulado "${book.title}":\n\n${excerpt}`,
      { temperature: 0.5, max_tokens: 500 },
    );

    if (!summary) {
      return res.status(500).json({ error: 'Error al generar resumen' });
    }

    // Save to DB
    updateBook(parseInt(req.params.id), { ai_summary: summary } as any);

    res.json({ summary, cached: false });
  } catch (err) {
    console.error('Summary generation error:', err);
    res.status(500).json({ error: 'Error interno al generar resumen' });
  }
});

// ── Categories ──
app.get('/api/categories', (_req, res) => {
  res.json(getCategories());
});

// ── Collections ──
import {
  getCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addBookToCollection,
  removeBookFromCollection,
  getBookCollections
} from './database.js';

app.get('/api/collections', optionalAuth, (req, res) => {
  const collections = getCollections();
  // Future: filter by req.userId when multi-user is fully active
  res.json(collections);
});

// Get collections for a specific book
app.get('/api/books/:id/collections', optionalAuth, (req, res) => {
  const { getBookCollections } = require('./database.js');
  const collections = getBookCollections(parseInt(req.params.id));
  res.json(collections);
});

app.post('/api/collections', optionalAuth, (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = createCollection(name, description, color);
  // Associate with user if authenticated
  if (req.userId) {
    const db = getDb();
    db.prepare('UPDATE collections SET user_id = @userId WHERE id = @id').run({ userId: req.userId, id });
  }
  res.json({ id, name, description, color });
});

app.put('/api/collections/:id', optionalAuth, (req, res) => {
  const { name, description, color } = req.body;
  updateCollection(parseInt(req.params.id), name, description, color);
  res.json({ success: true });
});

app.delete('/api/collections/:id', optionalAuth, (req, res) => {
  deleteCollection(parseInt(req.params.id));
  res.json({ success: true });
});

app.post('/api/collections/:id/books', optionalAuth, (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  addBookToCollection(parseInt(bookId), parseInt(req.params.id));
  res.json({ success: true });
});

app.delete('/api/collections/:id/books/:bookId', optionalAuth, (req, res) => {
  removeBookFromCollection(parseInt(req.params.bookId), parseInt(req.params.id));
  res.json({ success: true });
});

// ── Stats ──
app.get('/api/stats', (_req, res) => {
  res.json(getStats());
});

// ── Scan ──
app.post('/api/scan', async (_req, res) => {
  if (scanRunning) {
    return res.json({ status: 'already_running', progress: currentScan });
  }

  scanRunning = true;
  res.json({ status: 'started' });

  try {
    await scanLibrary(LIBRARY_PATH, (progress) => {
      currentScan = progress;
    });
  } catch (err) {
    console.error('Scan error:', err);
    if (currentScan) {
      currentScan.status = 'error';
      currentScan.errors.push(String(err));
    }
  } finally {
    scanRunning = false;
  }
});

app.get('/api/scan/status', (_req, res) => {
  if (!currentScan) {
    return res.json({ status: 'idle', total: 0, processed: 0, newBooks: 0, skipped: 0 });
  }
  res.json(currentScan);
});

// ── Health ──
app.get('/api/health', async (_req, res) => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  res.json({ status: 'ok', library: LIBRARY_PATH, ai: aiOnline, backend: isGroq ? 'groq' : 'hermes' });
});

// ── AI Chat (Groq / Hermes proxy) ──

app.post('/api/ai/chat', optionalAuth, (req, res) => {
  streamChat(req, res);
});

app.post('/api/organizer/chat', optionalAuth, (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] };
  
  // RAG Intermediary: Extract last user message to find relevant books
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  
  // Simple keyword extraction (remove common words)
  const keywords = lastUserMessage
    .replace(/[^\w\s\u00C0-\u017F]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 3)
    .join(' ');
    
  // Query local database for relevance
  let libraryContext = '';
  if (keywords) {
    const searchResult = getAllBooks(20, 0, { search: keywords });
    if (searchResult.books.length > 0) {
      libraryContext = searchResult.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | Título: "${b.title}" | Autor: ${b.author || 'Desconocido'} | Categoría: ${b.category_name || 'Sin categoría'}\n  Sinopsis: ${b.ai_summary ? b.ai_summary.substring(0, 150) + '...' : 'Sin sinopsis'}`
      ).join('\n\n');
    }
  }

  // If no direct keyword match, provide a random sample of uncategorized books
  if (!libraryContext) {
    const uncategorized = getAllBooks(10, 0, { category_id: 46 }); // 46 is usually 'Sin categoría'
    if (uncategorized.books.length > 0) {
      libraryContext = 'Libros recientes "Sin categoría" para organizar:\n' + uncategorized.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | Título: "${b.title}"`
      ).join('\n');
    }
  }

  // Inject library context into the request body for the hermes stream
  req.body.libraryContext = libraryContext;
  
  streamOrganizerChat(req, res);
});

app.get('/api/ai/health', async (_req, res) => {
  const online = await checkHermesHealth();
  res.json({ online });
});

// ── Web Search (for AI context enrichment) ──
app.post('/api/ai/search', async (req, res) => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  try {
    const results = await searchWeb(query.trim(), 5);
    const formatted = formatSearchResults(results);
    res.json({ results, formatted, count: results.length });
  } catch (err) {
    console.error('Web search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Bookmarks ──
app.get('/api/books/:id/bookmarks', optionalAuth, (req, res) => {
  const db = getDb();
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page ASC').all(parseInt(req.params.id));
  res.json(bookmarks);
});

app.post('/api/books/:id/bookmarks', optionalAuth, (req, res) => {
  const db = getDb();
  const { page, label, color } = req.body as { page: number; label?: string; color?: string };
  if (!page || page < 1) return res.status(400).json({ error: 'Valid page number required' });

  // Check if bookmark already exists for this page
  const existing = db.prepare('SELECT id FROM bookmarks WHERE book_id = ? AND page = ?').get(parseInt(req.params.id), page);
  if (existing) {
    return res.status(409).json({ error: 'Bookmark already exists for this page' });
  }

  const result = db.prepare('INSERT INTO bookmarks (book_id, page, label, color, user_id) VALUES (?, ?, ?, ?, ?)').run(
    parseInt(req.params.id),
    page,
    label || `Página ${page}`,
    color || '#667eea',
    req.userId || null,
  );
  res.json({ id: result.lastInsertRowid, page, label: label || `Página ${page}`, color: color || '#667eea' });
});

app.delete('/api/books/:id/bookmarks/:bookmarkId', optionalAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND book_id = ?').run(parseInt(req.params.bookmarkId), parseInt(req.params.id));
  res.json({ success: true });
});

// ── Affiliate Links & Monetization ──
import { getAffiliateLinks, upsertAffiliateLink, trackAffiliateClick } from './database.js';

// Get affiliate links for a book (public — shows buy options)
app.get('/api/books/:id/affiliate-links', optionalAuth, (req, res) => {
  const links = getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Add/update affiliate link for a book (admin only)
app.post('/api/books/:id/affiliate-links', requireAuth, (req, res) => {
  const { platform, affiliate_url, price_estimate, currency } = req.body;
  if (!platform || !affiliate_url) {
    return res.status(400).json({ error: 'platform y affiliate_url son requeridos.' });
  }
  
  upsertAffiliateLink(
    parseInt(req.params.id),
    platform,
    affiliate_url,
    price_estimate,
    currency || 'USD'
  );
  
  const links = getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Track a click on an affiliate link
app.post('/api/affiliate/click/:linkId', optionalAuth, (req, res) => {
  trackAffiliateClick(req.userId || null, parseInt(req.params.linkId));
  
  // Get the link URL to redirect
  const db = getDb();
  const link = db.prepare('SELECT affiliate_url FROM affiliate_links WHERE id = ?').get(parseInt(req.params.linkId)) as { affiliate_url: string } | undefined;
  
  if (link) {
    res.json({ redirect: link.affiliate_url });
  } else {
    res.status(404).json({ error: 'Enlace no encontrado.' });
  }
});

// Get affiliate analytics (admin)
app.get('/api/affiliate/stats', requireAuth, (req, res) => {
  const db = getDb();
  
  const totalClicks = (db.prepare('SELECT COUNT(*) as c FROM affiliate_clicks').get() as { c: number }).c;
  const clicksByPlatform = db.prepare(`
    SELECT al.platform, COUNT(ac.id) as clicks
    FROM affiliate_clicks ac
    JOIN affiliate_links al ON al.id = ac.link_id
    GROUP BY al.platform
    ORDER BY clicks DESC
  `).all();
  const topBooks = db.prepare(`
    SELECT b.title, b.author, al.platform, COUNT(ac.id) as clicks
    FROM affiliate_clicks ac
    JOIN affiliate_links al ON al.id = ac.link_id
    JOIN books b ON b.id = al.book_id
    GROUP BY al.book_id, al.platform
    ORDER BY clicks DESC
    LIMIT 10
  `).all();
  const recentClicks = db.prepare(`
    SELECT ac.clicked_at, al.platform, b.title, u.display_name
    FROM affiliate_clicks ac
    JOIN affiliate_links al ON al.id = ac.link_id
    JOIN books b ON b.id = al.book_id
    LEFT JOIN users u ON u.id = ac.user_id
    ORDER BY ac.clicked_at DESC
    LIMIT 20
  `).all();
  
  res.json({ totalClicks, clicksByPlatform, topBooks, recentClicks });
});

// ── User Uploads ──
import { upload, getUploadLimit, deleteUploadFile, UPLOADS_DIR as UPLOAD_PATH } from './uploadStorage.js';
import { getUserUploads, countUserUploads, insertUserUpload, deleteUserUpload } from './database.js';

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_PATH));

// List user's uploads
app.get('/api/uploads', requireAuth, (req, res) => {
  const uploads = getUserUploads(req.userId!);
  res.json(uploads);
});

// Upload a file
app.post('/api/uploads', requireAuth, (req, res) => {
  const limit = getUploadLimit(req.userPlan || 'free');
  const currentCount = countUserUploads(req.userId!);
  
  if (currentCount >= limit) {
    return res.status(403).json({ 
      error: `Límite de archivos alcanzado (${limit}). Elimina archivos existentes o mejora tu plan.` 
    });
  }

  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo excede el límite de 100 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Error al subir archivo.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }

    const uploadId = require('uuid').v4();
    insertUserUpload(
      uploadId,
      req.userId!,
      null, // book_id — can be linked later
      req.file.originalname,
      req.file.filename, // storage path (just the filename inside uploads dir)
      req.file.size
    );

    res.json({
      id: uploadId,
      original_filename: req.file.originalname,
      storage_path: req.file.filename,
      file_size: req.file.size,
      url: `/uploads/${req.file.filename}`,
    });
  });
});

// Delete an upload
app.delete('/api/uploads/:id', requireAuth, (req, res) => {
  const uploads = getUserUploads(req.userId!);
  const target = uploads.find((u: any) => u.id === req.params.id);
  
  if (!target) {
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  }

  // Delete physical file
  deleteUploadFile((target as any).storage_path);
  // Delete DB record
  deleteUserUpload(req.params.id, req.userId!);
  
  res.json({ success: true });
});

// ══════════════════════════════════════
//  Production: Serve Frontend Static Files
// ══════════════════════════════════════
const DIST_DIR = join(__dirname, '..', '..', 'dist');
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: serve index.html for any non-API route
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/covers/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
  console.log('🌐 Serving production frontend from', DIST_DIR);
}

// ══════════════════════════════════════
//  Start Server
// ══════════════════════════════════════
app.listen(PORT, async () => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  console.log(`\n🏛️  BiblioVault API running on http://localhost:${PORT}`);
  console.log(`📚 Library path: ${LIBRARY_PATH}`);
  console.log(`🤖 AI Backend: ${isGroq ? 'Groq Cloud' : 'Local Hermes'} — ${aiOnline ? '✅ Online' : '⚠️ Offline'}`);
  console.log(`📊 Endpoints ready\n`);
});

// ══════════════════════════════════════
//  Enrichment Endpoints
// ══════════════════════════════════════

// Enrich a single book
app.post('/api/books/:id/enrich', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  try {
    const result = await enrichBook(
      parseInt(req.params.id),
      book.file_name as string,
      book.author as string,
      book.file_path as string,
    );

    if (result.found) {
      // Update database with enrichment data
      const updates: Record<string, unknown> = {
        enriched: 1,
        enrichment_source: result.source,
      };

      if (result.title) {
        updates.original_title = book.title; // Keep original
        updates.title = result.title;
      }
      if (result.author) updates.author = result.author;
      if (result.description) updates.description = result.description;
      if (result.isbn) updates.isbn = result.isbn;
      if (result.pages && (book.pages as number) === 0) updates.pages = result.pages;
      if (result.coverPath) {
        updates.cover_path = result.coverPath;
        updates.cover_source = 'api';
      }

      updateBook(parseInt(req.params.id), updates as any);
    } else {
      // Mark as enriched (attempted) even if not found
      updateBook(parseInt(req.params.id), { enriched: 1 } as any);
    }

    res.json(result);
  } catch (err) {
    console.error('Enrichment failed:', err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

// Batch enrich all un-enriched books
app.post('/api/enrich/batch', async (_req, res) => {
  const state = getBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }

  resetBatchState();
  const books = getUnenrichedBooks();

  // Start in background
  runBatchEnrichment(books, (bookId, result) => {
    const updates: Record<string, unknown> = {
      enriched: 1,
      enrichment_source: result.source,
    };

    if (result.title) {
      const book = getBookById(bookId) as Record<string, unknown>;
      updates.original_title = book?.title || '';
      updates.title = result.title;
    }
    if (result.author) updates.author = result.author;
    if (result.description) updates.description = result.description;
    if (result.isbn) updates.isbn = result.isbn;
    if (result.pages) updates.pages = result.pages;
    if (result.coverPath) {
      updates.cover_path = result.coverPath;
      updates.cover_source = 'api';
    }

    updateBook(bookId, updates as any);
  });

  res.json({ message: 'Batch enrichment started', total: books.length });
});

// Get enrichment status
app.get('/api/enrich/status', (_req, res) => {
  res.json(getBatchState());
});

// Cancel batch enrichment
app.post('/api/enrich/cancel', (_req, res) => {
  cancelBatchEnrichment();
  res.json({ message: 'Cancelled' });
});

// Extract PDF first page as cover image
app.post('/api/books/:id/extract-cover', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  if (book.format !== 'pdf') {
    return res.status(400).json({ error: 'Only PDF books supported' });
  }

  try {
    const coverPath = await extractPdfCover(
      book.file_path as string,
      parseInt(req.params.id),
    );

    if (coverPath) {
      updateBook(parseInt(req.params.id), {
        cover_path: coverPath,
        cover_source: 'pdf',
      } as any);
      res.json({ success: true, coverPath });
    } else {
      res.json({ success: false, message: 'Could not extract cover' });
    }
  } catch (err) {
    console.error('PDF cover extraction failed:', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// ── Batch Cover Extraction ──

// Start batch cover extraction for all books with SVG placeholders
app.post('/api/covers/batch', async (_req, res) => {
  const state = getCoverBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }

  resetCoverBatchState();
  const books = getBooksWithoutCovers();

  // Start in background
  runBatchCoverExtraction(books, (bookId, coverPath, source) => {
    updateBook(bookId, {
      cover_path: coverPath,
      cover_source: source,
    } as any);
  });

  res.json({ message: 'Batch cover extraction started', total: books.length });
});

// Get batch cover extraction status
app.get('/api/covers/batch/status', (_req, res) => {
  res.json(getCoverBatchState());
});

// Cancel batch cover extraction
app.post('/api/covers/batch/cancel', (_req, res) => {
  cancelCoverBatchJob();
  res.json({ message: 'Cancelled' });
});

// AI Title Identification — read PDF text and ask LLM to find real title
app.post('/api/books/:id/identify-title', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const filePath = book.file_path as string;
  const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

  try {
    let result = null;

    if (ext === 'pdf') {
      // Standard PDF text extraction
      result = await identifyTitleFromPdf(filePath, book.title as string);
    } else {
      // For non-PDF formats (.doc, .docx, .epub, etc.), 
      // use filename + folder context to ask AI
      const folderCategory = book.folder_category as string || '';
      const fileName = book.file_name as string || '';

      // Call Hermes with filename context only
      const fakeText = `Nombre del archivo: "${fileName}"\nCategoría/carpeta: "${folderCategory}"\n\nEste es un archivo .${ext} cuyo texto no puede extraerse directamente.`;

      // Use the identifier with the filename as context
      result = await identifyTitleFromPdf(filePath, book.title as string).catch(() => null);

      // If PDF extraction failed (expected for .doc), try using just filename
      if (!result) {
        const { identifyTitleFromFilename } = await import('./aiTitleIdentifier.js');
        result = await identifyTitleFromFilename(
          book.title as string,
          book.file_name as string,
          book.folder_category as string || '',
        );
      }
    }

    if (result && result.confidence !== 'low') {
      res.json({ success: true, ...result });
    } else {
      res.json({
        success: false,
        message: result ? 'Low confidence identification' : 'No se pudo leer el texto del archivo',
        ...result,
      });
    }
  } catch (err) {
    console.error('AI title identification failed:', err);
    res.status(500).json({ error: 'Identification failed' });
  }
});

// ═══════════════════════════════════════
//  Full-Text Search (Phase 8)
// ═══════════════════════════════════════

// Global full-text search across all books
app.get('/api/search/fulltext', (req, res) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const limit = parseInt(req.query.limit as string) || 50;
  const results = searchFullText(q, limit);
  res.json({ results, query: q });
});

// Search within a specific book
app.get('/api/books/:id/search', (req, res) => {
  const bookId = parseInt(req.params.id);
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = searchInBook(bookId, q);
  res.json({ results, query: q });
});

// Index a single book
app.post('/api/books/:id/index', async (req, res) => {
  const book = getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (book.format !== 'pdf') return res.json({ indexed: 0, message: 'Only PDFs can be indexed' });
  const pages = await indexBookText(parseInt(req.params.id), book.file_path as string);
  res.json({ indexed: pages });
});

// Batch index all PDFs
app.post('/api/search/index/batch', async (_req, res) => {
  const state = getIndexBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }
  resetIndexBatchState();
  runBatchIndexing(); // Fire and forget
  res.json({ message: 'Indexing started' });
});

// Batch index status
app.get('/api/search/index/status', (_req, res) => {
  res.json(getIndexBatchState());
});

// Cancel batch indexing
app.post('/api/search/index/cancel', (_req, res) => {
  cancelIndexBatch();
  res.json({ message: 'Cancelled' });
});

// Index stats
app.get('/api/search/index/stats', (_req, res) => {
  res.json(getIndexStats());
});

// ═══════════════════════════════════════
//  Fase 9: Statistics, Export & Backup
// ═══════════════════════════════════════

// Extended statistics for the Dashboard
app.get('/api/stats/extended', (_req, res) => {
  const db = getDb();
  try {
    const totalBooks = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
    const totalPages = (db.prepare('SELECT SUM(pages) as s FROM books').get() as { s: number }).s || 0;
    
    // Books completed (progress >= 0.99)
    const completedBooks = (db.prepare('SELECT COUNT(*) as c FROM books WHERE reading_progress >= 0.99').get() as { c: number }).c;

    // Books by format
    const formatStats = db.prepare(`
      SELECT format as name, COUNT(*) as value 
      FROM books 
      GROUP BY format
    `).all() as Array<{ name: string; value: number }>;

    // Top 5 categories
    const categoryStats = db.prepare(`
      SELECT c.name as name, COUNT(b.id) as value
      FROM categories c
      JOIN books b ON b.category_id = c.id
      GROUP BY c.id
      ORDER BY value DESC
      LIMIT 5
    `).all() as Array<{ name: string; value: number }>;

    // Calculate approximate pages read
    const pagesReadRows = db.prepare('SELECT pages, reading_progress FROM books WHERE reading_progress > 0').all() as Array<{ pages: number; reading_progress: number }>;
    const totalPagesRead = Math.round(pagesReadRows.reduce((acc, row) => acc + (row.pages * row.reading_progress), 0));

    res.json({
      totalBooks,
      totalPages,
      completedBooks,
      totalPagesRead,
      formatStats,
      categoryStats
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch extended stats' });
  }
});

// Export library as CSV
app.get('/api/export/csv', (_req, res) => {
  const db = getDb();
  try {
    const books = db.prepare(`
      SELECT b.id, b.title, b.author, b.isbn, b.format, b.pages, c.name as category, b.reading_progress, b.date_added
      FROM books b
      LEFT JOIN categories c ON b.category_id = c.id
      ORDER BY b.id ASC
    `).all() as Array<any>;

    if (books.length === 0) {
      return res.status(404).send('No books to export');
    }

    const headers = Object.keys(books[0]).join(',');
    const rows = books.map(b => {
      return Object.values(b).map(v => {
        if (v === null || v === undefined) return '""';
        const str = String(v).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });

    const csvStr = headers + '\\n' + rows.join('\\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bibliovault_export.csv"');
    res.send(csvStr);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).send('Failed to export CSV');
  }
});

// Download DB Backup
import { DB_PATH } from './database.js';
import { existsSync } from 'fs';

app.get('/api/backup', (_req, res) => {
  if (existsSync(DB_PATH)) {
    // res.download needs absolute path, which DB_PATH is.
    res.download(DB_PATH, 'bibliovault.db', (err) => {
      if (err) console.error('Backup download error:', err);
    });
  } else {
    res.status(404).send('Database not found');
  }
});
