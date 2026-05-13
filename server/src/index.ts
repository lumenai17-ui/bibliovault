import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  isPostgres,
  getAllBooks,
  getBookById,
  updateBook,
  getCategories,
  getStats,
  getUnenrichedBooks,
  getBooksWithoutCovers,
  getUserById,
  updateUser,
  getCollections,
  createCollection,
  updateCollection as updateCollectionDb,
  deleteCollection as deleteCollectionDb,
  addBookToCollection,
  removeBookFromCollection,
  getBookCollections,
  getAffiliateLinks,
  upsertAffiliateLink,
  trackAffiliateClick,
  getUserUploads,
  countUserUploads,
  insertUserUpload,
  deleteUserUpload,
} from './db.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const LIBRARY_PATH = process.env.LIBRARY_PATH || 'C:\\Users\\Usuario\\OneDrive\\Documentos\\Lectura';

// Trust proxy for Render (HTTPS termination)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve static covers
app.use('/covers', express.static(COVERS_DIR));

// Initialize database on startup (async for PostgreSQL support)
await initDatabase();
await initFtsSchema();
console.log('ðŸ“¦ Database initialized');

// Sync cover paths on startup â€” only for local SQLite mode
if (!isPostgres()) {
  const { getDb } = await import('./database.js');
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
      await updateBook(book.id, { cover_path: jpgPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pngPath) && book.cover_path !== pngPath) {
      await updateBook(book.id, { cover_path: pngPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pdfJpgPath) && book.cover_path !== pdfJpgPath) {
      await updateBook(book.id, { cover_path: pdfJpgPath, cover_source: 'pdf' } as any);
      updated++;
    }
  }
  if (updated > 0) console.log(`ðŸ–¼ï¸  Cover sync: updated ${updated} book cover paths`);
}

// â”€â”€ Scan state â”€â”€
let currentScan: ScanProgress | null = null;
let scanRunning = false;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  API Routes
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Authentication â”€â”€

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
    res.status(500).json({ error: 'Error al iniciar sesiÃ³n.' });
  }
});

app.post('/api/auth/logout', async (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  
  const user = await getAuthenticatedUser(token);
  if (!user) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'SesiÃ³n invÃ¡lida.' });
  }

  res.json({ user });
});

app.put('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { displayName, avatar_url } = req.body;
    const updates: Record<string, string> = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    
    await updateUser(req.userId!, updates as any);
    const user = await getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Error al actualizar perfil.' });
  }
});

// â”€â”€ Books â”€â”€
app.get('/api/books', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 200;
  const offset = parseInt(req.query.offset as string) || 0;
  const format = req.query.format as string | undefined;
  const category_id = req.query.category_id ? parseInt(req.query.category_id as string) : undefined;
  const favorite = req.query.favorite === 'true' ? true : undefined;
  const search = req.query.search as string | undefined;
  const collection_id = req.query.collection_id ? parseInt(req.query.collection_id as string) : undefined;

  const result = await getAllBooks(limit, offset, { format, category_id, favorite, search, collection_id });
  res.json(result);
});

app.get('/api/books/:id', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id));
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});

app.patch('/api/books/:id', async (req, res) => {
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
  await updateBook(id, updates);
  res.json({ ok: true });
});

// â”€â”€ Extract HTML from DOC/DOCX for Web Reader â”€â”€
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

app.get('/api/books/:id/html', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath);
  if (!filePath) return res.status(404).json({ error: 'File not found (local or tunnel)' });

  const ext = (origPath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  
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
const TUNNEL_URL = process.env.TUNNEL_URL || ''; // e.g. https://xyz.trycloudflare.com
const TUNNEL_SECRET = process.env.TUNNEL_SECRET || 'bv-tunnel-2026';

// Helper: resolve a file path — local first, then via tunnel download to temp
import { tmpdir } from 'os';
import { createHash } from 'crypto';

async function resolveFilePath(filePath: string): Promise<string | null> {
  // 1. Local file exists?
  if (existsSync(filePath)) return filePath;
  
  // 2. Check temp cache (avoid re-downloading)
  const hash = createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const ext = filePath.match(/\.([^.]+)$/)?.[1] || 'bin';
  const tempPath = join(tmpdir(), `bv_${hash}.${ext}`);
  if (existsSync(tempPath)) return tempPath;
  
  // 3. Try tunnel
  if (!TUNNEL_URL) return null;
  
  try {
    console.log(`📡 Tunnel download: ${filePath.slice(-60)}`);
    const tunnelFileUrl = `${TUNNEL_URL}/file?path=${encodeURIComponent(filePath)}&secret=${TUNNEL_SECRET}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
    
    const tunnelRes = await fetch(tunnelFileUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!tunnelRes.ok) {
      console.error(`📡 Tunnel error ${tunnelRes.status} for: ${filePath.slice(-60)}`);
      return null;
    }
    
    const buffer = Buffer.from(await tunnelRes.arrayBuffer());
    writeFileSync(tempPath, buffer);
    console.log(`📡 Tunnel OK: ${Math.round(buffer.length/1024)}KB → ${tempPath}`);
    return tempPath;
  } catch (err: any) {
    console.error(`📡 Tunnel failed for ${filePath.slice(-60)}:`, err.message);
    return null;
  }
}

app.get('/api/books/:id/file', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  const filePath = book.file_path as string;

  // Try local file first (dev mode)
  if (existsSync(filePath)) {
    const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf', epub: 'application/epub+zip',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
    };
    res.setHeader('Content-Type', mimeMap[ext || ''] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${book.file_name}"`);
    return res.sendFile(filePath);
  }

  // Production: proxy through Cloudflare Tunnel
  if (TUNNEL_URL) {
    try {
      const tunnelFileUrl = `${TUNNEL_URL}/file?path=${encodeURIComponent(filePath)}&secret=${TUNNEL_SECRET}`;
      const tunnelRes = await fetch(tunnelFileUrl);
      if (!tunnelRes.ok) {
        return res.status(tunnelRes.status).json({ error: 'File not available via tunnel' });
      }
      res.setHeader('Content-Type', tunnelRes.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', tunnelRes.headers.get('content-disposition') || `inline; filename="${book.file_name}"`);
      const buffer = Buffer.from(await tunnelRes.arrayBuffer());
      return res.send(buffer);
    } catch (err) {
      console.error('Tunnel proxy error:', err);
      return res.status(502).json({ error: 'Tunnel unavailable' });
    }
  }

  res.status(404).json({ error: 'File not found. Start the tunnel on your PC.' });
});

// â”€â”€ Cover serving (supports JPG from API/PDF and SVG fallback) â”€â”€
app.get('/api/books/:id/cover', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
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

  // 1. Check existing cover_path (could be API jpg, PDF jpg, SVG, or Supabase URL)
  const coverPath = book.cover_path as string;
  if (coverPath && coverPath.startsWith('http')) {
    // Supabase Storage URL — redirect to it
    return res.redirect(coverPath);
  }
  if (coverPath && existsSync(coverPath)) {
    return serveImage(coverPath);
  }

  // 2. Check if a downloaded API cover exists
  const jpgPath = join(COVERS_DIR, `${bookId}.jpg`);
  const pngPath = join(COVERS_DIR, `${bookId}.png`);
  if (existsSync(jpgPath)) {
    await updateBook(bookId, { cover_path: jpgPath, cover_source: 'api' } as any);
    return serveImage(jpgPath);
  }
  if (existsSync(pngPath)) {
    await updateBook(bookId, { cover_path: pngPath, cover_source: 'api' } as any);
    return serveImage(pngPath);
  }

  // 3. Check if a PDF-extracted cover exists
  const pdfCoverPath = join(COVERS_DIR, `${bookId}_pdf.jpg`);
  if (existsSync(pdfCoverPath)) {
    await updateBook(bookId, { cover_path: pdfCoverPath, cover_source: 'pdf' } as any);
    return serveImage(pdfCoverPath);
  }

  // 4. Generate SVG fallback
  const filePath = await resolveFilePath(book.file_path as string) || book.file_path as string;
  try {
    const newCoverPath = await generateCover(
      bookId, filePath, book.title as string, book.author as string,
    );
    if (newCoverPath && existsSync(newCoverPath)) {
      await updateBook(bookId, { cover_path: newCoverPath, cover_source: 'svg' } as any);
      return serveImage(newCoverPath);
    }
  } catch (err) {
    console.error('Cover generation failed:', err);
  }

  res.status(204).end();
});

// â”€â”€ Text Extraction â”€â”€
app.get('/api/books/:id/text', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath);
  if (!filePath) return res.status(404).json({ error: 'File not found (local or tunnel)' });

  const startPage = req.query.start ? parseInt(req.query.start as string) : undefined;
  const endPage = req.query.end ? parseInt(req.query.end as string) : undefined;

  const result = await extractPdfText(filePath, startPage, endPage);
  res.json(result);
});

// â”€â”€ AI Summary Generation â”€â”€
app.post('/api/books/:id/summary', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const forceOcr = req.query.ocr === 'true';

  // Check if summary already exists (and we are not forcing a refresh)
  if (book.ai_summary && req.query.refresh !== 'true') {
    return res.json({ summary: book.ai_summary, cached: true });
  }

  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath);
  if (!filePath) return res.status(404).json({ error: 'File not found (local or tunnel)' });

  try {
    let excerpt = '';

    if (forceOcr) {
      console.log(`ðŸ‘ï¸ Forcing OCR extraction for summary of "${book.title}"`);
      const { extractOcrText } = await import('./ocrExtractor.js');
      excerpt = await extractOcrText(filePath, 4);
    } else {
      // Normal extraction
      excerpt = await extractBookExcerpt(filePath, 3000);
      
      // Fallback to OCR if empty
      if (!excerpt || excerpt.length < 50) {
        console.log(`âš ï¸ Book "${book.title}" seems to be scanned. Running OCR for summary...`);
        try {
          const { extractOcrText } = await import('./ocrExtractor.js');
          excerpt = await extractOcrText(filePath, 4);
        } catch (ocrErr) {
          console.error('OCR fallback failed for summary:', ocrErr);
        }
      }
    }
    
    if (!excerpt || excerpt.length < 50) {
      return res.json({ summary: 'Este libro parece ser un escaneo de imÃ¡genes. No se pudo leer el texto ni siquiera con OCR.', cached: false });
    }

    // Ask LLM (Groq or Hermes) for a summary
    const llmOnline = await checkHermesHealth();
    if (!llmOnline) {
      return res.status(503).json({ error: 'AI no estÃ¡ disponible (ni Groq ni Hermes)' });
    }

    const summary = await llmComplete(
      'Eres un bibliotecario experto. Genera resÃºmenes concisos y Ãºtiles de libros. Responde en espaÃ±ol. El resumen debe tener 2-3 pÃ¡rrafos mÃ¡ximo.',
      `Genera un resumen del siguiente libro titulado "${book.title}":\n\n${excerpt}`,
      { temperature: 0.5, max_tokens: 500 },
    );

    if (!summary) {
      return res.status(500).json({ error: 'Error al generar resumen' });
    }

    // Save to DB
    await updateBook(parseInt(req.params.id), { ai_summary: summary } as any);

    res.json({ summary, cached: false });
  } catch (err) {
    console.error('Summary generation error:', err);
    res.status(500).json({ error: 'Error interno al generar resumen' });
  }
});

// â”€â”€ Categories â”€â”€
app.get('/api/categories', async (_req, res) => {
  res.json(await getCategories());
});

// â”€â”€ Collections â”€â”€
// Collections imported from db.js at top

app.get('/api/collections', optionalAuth, async (req, res) => {
  const collections = await getCollections();
  // Future: filter by req.userId when multi-user is fully active
  res.json(collections);
});

// Get collections for a specific book
app.get('/api/books/:id/collections', optionalAuth, async (req, res) => {
  const { getBookCollections } = require('./database.js');
  const collections = await getBookCollections(parseInt(req.params.id));
  res.json(collections);
});

app.post('/api/collections', optionalAuth, async (req, res) => {
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

app.put('/api/collections/:id', optionalAuth, async (req, res) => {
  const { name, description, color } = req.body;
  updateCollection(parseInt(req.params.id), name, description, color);
  res.json({ success: true });
});

app.delete('/api/collections/:id', optionalAuth, async (req, res) => {
  deleteCollection(parseInt(req.params.id));
  res.json({ success: true });
});

app.post('/api/collections/:id/books', optionalAuth, async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  await addBookToCollection(parseInt(bookId), parseInt(req.params.id));
  res.json({ success: true });
});

app.delete('/api/collections/:id/books/:bookId', optionalAuth, async (req, res) => {
  await removeBookFromCollection(parseInt(req.params.bookId), parseInt(req.params.id));
  res.json({ success: true });
});

// â”€â”€ Stats â”€â”€
app.get('/api/stats', async (_req, res) => {
  res.json(await getStats());
});

// â”€â”€ Scan â”€â”€
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

app.get('/api/scan/status', async (_req, res) => {
  if (!currentScan) {
    return res.json({ status: 'idle', total: 0, processed: 0, newBooks: 0, skipped: 0 });
  }
  res.json(currentScan);
});

// â”€â”€ Health â”€â”€
app.get('/api/health', async (_req, res) => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  res.json({ status: 'ok', library: LIBRARY_PATH, ai: aiOnline, backend: isGroq ? 'groq' : 'hermes' });
});

// â”€â”€ AI Chat (Groq / Hermes proxy) â”€â”€

app.post('/api/ai/chat', optionalAuth, async (req, res) => {
  streamChat(req, res);
});

app.post('/api/organizer/chat', optionalAuth, async (req, res) => {
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
    const searchResult = await getAllBooks(20, 0, { search: keywords });
    if (searchResult.books.length > 0) {
      libraryContext = searchResult.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | TÃ­tulo: "${b.title}" | Autor: ${b.author || 'Desconocido'} | CategorÃ­a: ${b.category_name || 'Sin categorÃ­a'}\n  Sinopsis: ${b.ai_summary ? b.ai_summary.substring(0, 150) + '...' : 'Sin sinopsis'}`
      ).join('\n\n');
    }
  }

  // If no direct keyword match, provide a random sample of uncategorized books
  if (!libraryContext) {
    const uncategorized = await getAllBooks(10, 0, { category_id: 46 }); // 46 is usually 'Sin categorÃ­a'
    if (uncategorized.books.length > 0) {
      libraryContext = 'Libros recientes "Sin categorÃ­a" para organizar:\n' + uncategorized.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | TÃ­tulo: "${b.title}"`
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

// â”€â”€ Web Search (for AI context enrichment) â”€â”€
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

// â”€â”€ Bookmarks â”€â”€
app.get('/api/books/:id/bookmarks', optionalAuth, async (req, res) => {
  const db = getDb();
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page ASC').all(parseInt(req.params.id));
  res.json(bookmarks);
});

app.post('/api/books/:id/bookmarks', optionalAuth, async (req, res) => {
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
    label || `PÃ¡gina ${page}`,
    color || '#667eea',
    req.userId || null,
  );
  res.json({ id: result.lastInsertRowid, page, label: label || `PÃ¡gina ${page}`, color: color || '#667eea' });
});

app.delete('/api/books/:id/bookmarks/:bookmarkId', optionalAuth, async (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND book_id = ?').run(parseInt(req.params.bookmarkId), parseInt(req.params.id));
  res.json({ success: true });
});

// â”€â”€ Affiliate Links & Monetization â”€â”€
// Affiliate imports from db.js at top

// Get affiliate links for a book (public â€” shows buy options)
app.get('/api/books/:id/affiliate-links', optionalAuth, async (req, res) => {
  const links = await getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Add/update affiliate link for a book (admin only)
app.post('/api/books/:id/affiliate-links', requireAuth, async (req, res) => {
  const { platform, affiliate_url, price_estimate, currency } = req.body;
  if (!platform || !affiliate_url) {
    return res.status(400).json({ error: 'platform y affiliate_url son requeridos.' });
  }
  
  await upsertAffiliateLink(
    parseInt(req.params.id),
    platform,
    affiliate_url,
    price_estimate,
    currency || 'USD'
  );
  
  const links = await getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Track a click on an affiliate link
app.post('/api/affiliate/click/:linkId', optionalAuth, async (req, res) => {
  await trackAffiliateClick(req.userId || null, parseInt(req.params.linkId));
  
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
app.get('/api/affiliate/stats', requireAuth, async (req, res) => {
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

// â”€â”€ User Uploads â”€â”€
import { upload, getUploadLimit, deleteUploadFile, UPLOADS_DIR as UPLOAD_PATH } from './uploadStorage.js';
// Upload imports from db.js at top

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_PATH));

// List user's uploads
app.get('/api/uploads', requireAuth, async (req, res) => {
  const uploads = await getUserUploads(req.userId!);
  res.json(uploads);
});

// Upload a file
app.post('/api/uploads', requireAuth, async (req, res) => {
  const limit = getUploadLimit(req.userPlan || 'free');
  const currentCount = await countUserUploads(req.userId!);
  
  if (currentCount >= limit) {
    return res.status(403).json({ 
      error: `LÃ­mite de archivos alcanzado (${limit}). Elimina archivos existentes o mejora tu plan.` 
    });
  }

  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo excede el lÃ­mite de 100 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Error al subir archivo.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibiÃ³ ningÃºn archivo.' });
    }

    const uploadId = require('uuid').v4();
    await insertUserUpload(
      uploadId,
      req.userId!,
      null, // book_id â€” can be linked later
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
app.delete('/api/uploads/:id', requireAuth, async (req, res) => {
  const uploads = await getUserUploads(req.userId!);
  const target = uploads.find((u: any) => u.id === req.params.id);
  
  if (!target) {
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  }

  // Delete physical file
  deleteUploadFile((target as any).storage_path);
  // Delete DB record
  await deleteUserUpload(req.params.id, req.userId!);
  
  res.json({ success: true });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Production: Serve Frontend Static Files
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const DIST_DIR = join(__dirname, '..', '..', 'dist');
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: serve index.html for any non-API route
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/covers/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
  console.log('ðŸŒ Serving production frontend from', DIST_DIR);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Start Server
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.listen(PORT, async () => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  console.log(`\nðŸ›ï¸  BiblioVault API running on http://localhost:${PORT}`);
  console.log(`ðŸ“š Library path: ${LIBRARY_PATH}`);
  console.log(`ðŸ¤– AI Backend: ${isGroq ? 'Groq Cloud' : 'Local Hermes'} â€” ${aiOnline ? 'âœ… Online' : 'âš ï¸ Offline'}`);
  console.log(`ðŸ“Š Endpoints ready\n`);
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Enrichment Endpoints
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Enrich a single book
app.post('/api/books/:id/enrich', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
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

      await updateBook(parseInt(req.params.id), updates as any);
    } else {
      // Mark as enriched (attempted) even if not found
      await updateBook(parseInt(req.params.id), { enriched: 1 } as any);
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
  runBatchEnrichment(books, async (bookId, result) => {
    const updates: Record<string, unknown> = {
      enriched: 1,
      enrichment_source: result.source,
    };

    if (result.title) {
      const book = await getBookById(bookId) as Record<string, unknown>;
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

    await updateBook(bookId, updates as any);
  });

  res.json({ message: 'Batch enrichment started', total: books.length });
});

// Get enrichment status
app.get('/api/enrich/status', async (_req, res) => {
  res.json(getBatchState());
});

// Cancel batch enrichment
app.post('/api/enrich/cancel', async (_req, res) => {
  cancelBatchEnrichment();
  res.json({ message: 'Cancelled' });
});

// Extract PDF first page as cover image
app.post('/api/books/:id/extract-cover', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  if (book.format !== 'pdf') {
    return res.status(400).json({ error: 'Only PDF books supported' });
  }

  try {
    // Resolve file path (local or via tunnel)
    const filePath = await resolveFilePath(book.file_path as string);
    if (!filePath) return res.status(404).json({ error: 'PDF file not accessible' });

    const coverPath = await extractPdfCover(filePath, bookId);

    if (coverPath && existsSync(coverPath)) {
      // Upload to Supabase Storage if configured
      let finalCoverPath = coverPath;
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(supabaseUrl, supabaseKey);
          const coverBuffer = readFileSync(coverPath);
          const coverFilename = `${bookId}_pdf.jpg`;
          
          await supabase.storage.from('covers').upload(coverFilename, coverBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          
          finalCoverPath = `${supabaseUrl}/storage/v1/object/public/covers/${coverFilename}`;
          console.log(`📸 Cover uploaded to Supabase: ${coverFilename}`);
        } catch (uploadErr) {
          console.error('Supabase cover upload failed, using local path:', uploadErr);
        }
      }

      await updateBook(bookId, {
        cover_path: finalCoverPath,
        cover_source: 'pdf',
      } as any);
      res.json({ success: true, coverPath: finalCoverPath });
    } else {
      res.json({ success: false, message: 'Could not extract cover' });
    }
  } catch (err) {
    console.error('PDF cover extraction failed:', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// â”€â”€ Batch Cover Extraction â”€â”€

// Start batch cover extraction for all books with SVG placeholders
app.post('/api/covers/batch', async (_req, res) => {
  const state = getCoverBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }

  resetCoverBatchState();
  const books = getBooksWithoutCovers();

  // Start in background
  runBatchCoverExtraction(books, async (bookId, coverPath, source) => {
    await updateBook(bookId, {
      cover_path: coverPath,
      cover_source: source,
    } as any);
  });

  res.json({ message: 'Batch cover extraction started', total: books.length });
});

// Get batch cover extraction status
app.get('/api/covers/batch/status', async (_req, res) => {
  res.json(getCoverBatchState());
});

// Cancel batch cover extraction
app.post('/api/covers/batch/cancel', async (_req, res) => {
  cancelCoverBatchJob();
  res.json({ message: 'Cancelled' });
});

// AI Title Identification with Vision AI fallback
app.post('/api/books/:id/identify-title', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath) || origPath;
  const ext = (origPath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

  try {
    let result = null;

    if (ext === 'pdf') {
      let coverImagePath: string | undefined;
      const coverPath = book.cover_path as string;
      
      if (coverPath && !coverPath.startsWith('http') && existsSync(coverPath)) {
        coverImagePath = coverPath;
      } else {
        try {
          const extracted = await extractPdfCover(filePath, bookId);
          if (extracted && existsSync(extracted)) coverImagePath = extracted;
        } catch { /* ignore */ }
      }

      result = await identifyTitleFromPdf(filePath, book.title as string, coverImagePath);
    } else {
      const { identifyTitleFromFilename } = await import('./aiTitleIdentifier.js');
      result = await identifyTitleFromFilename(
        book.title as string,
        book.file_name as string,
        book.folder_category as string || '',
      );
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Full-Text Search (Phase 8)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Global full-text search across all books
app.get('/api/search/fulltext', async (req, res) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const limit = parseInt(req.query.limit as string) || 50;
  const results = await searchFullText(q, limit);
  res.json({ results, query: q });
});

// Search within a specific book
app.get('/api/books/:id/search', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = await searchInBook(bookId, q);
  res.json({ results, query: q });
});

// Index a single book
app.post('/api/books/:id/index', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
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
app.get('/api/search/index/status', async (_req, res) => {
  res.json(getIndexBatchState());
});

// Cancel batch indexing
app.post('/api/search/index/cancel', async (_req, res) => {
  cancelIndexBatch();
  res.json({ message: 'Cancelled' });
});

// Index stats
app.get('/api/search/index/stats', async (_req, res) => {
  res.json(await getIndexStats());
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Fase 9: Statistics, Export & Backup
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Extended statistics for the Dashboard
app.get('/api/stats/extended', async (_req, res) => {
  try {
    const allBooks = await getAllBooks() as Array<Record<string, any>>;
    
    const totalBooks = allBooks.length;
    const totalPages = allBooks.reduce((sum, b) => sum + (b.pages || 0), 0);
    const completedBooks = allBooks.filter(b => (b.reading_progress || 0) >= 0.99).length;
    
    // Books by format
    const formatMap = new Map<string, number>();
    allBooks.forEach(b => {
      const fmt = b.format || 'unknown';
      formatMap.set(fmt, (formatMap.get(fmt) || 0) + 1);
    });
    const formatStats = Array.from(formatMap.entries()).map(([name, value]) => ({ name, value }));

    // Top 5 categories
    const categories = await getCategories() as Array<Record<string, any>>;
    const catMap = new Map<number, string>();
    categories.forEach(c => catMap.set(c.id, c.name));
    
    const catCountMap = new Map<string, number>();
    allBooks.forEach(b => {
      const catName = catMap.get(b.category_id) || 'Sin categoría';
      catCountMap.set(catName, (catCountMap.get(catName) || 0) + 1);
    });
    const categoryStats = Array.from(catCountMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Pages read
    const totalPagesRead = Math.round(
      allBooks.reduce((acc, b) => acc + ((b.pages || 0) * (b.reading_progress || 0)), 0)
    );

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
app.get('/api/export/csv', async (_req, res) => {
  try {
    const allBooks = await getAllBooks() as Array<Record<string, any>>;
    const categories = await getCategories() as Array<Record<string, any>>;
    const catMap = new Map<number, string>();
    categories.forEach(c => catMap.set(c.id, c.name));

    if (allBooks.length === 0) {
      return res.status(404).send('No books to export');
    }

    const headers = ['id', 'title', 'author', 'isbn', 'format', 'pages', 'category', 'reading_progress', 'date_added'];
    const rows = allBooks.map(b => {
      const values = [
        b.id, b.title, b.author, b.isbn, b.format, b.pages,
        catMap.get(b.category_id) || '', b.reading_progress, b.date_added
      ];
      return values.map(v => {
        if (v === null || v === undefined) return '""';
        const str = String(v).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });

    const csvStr = headers.join(',') + '\n' + rows.join('\n');

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

app.get('/api/backup', async (_req, res) => {
  if (existsSync(DB_PATH)) {
    // res.download needs absolute path, which DB_PATH is.
    res.download(DB_PATH, 'bibliovault.db', (err) => {
      if (err) console.error('Backup download error:', err);
    });
  } else {
    res.status(404).send('Database not found');
  }
});
