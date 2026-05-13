/**
 * Metadata Enricher — Searches external APIs to find real book info + covers
 * 
 * Priority: Open Library → Google Books → PDF extraction → SVG fallback
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = join(__dirname, '..', 'data', 'covers');

if (!existsSync(COVERS_DIR)) mkdirSync(COVERS_DIR, { recursive: true });

export interface EnrichmentResult {
  found: boolean;
  source: 'openlibrary' | 'googlebooks' | 'none';
  title?: string;
  author?: string;
  description?: string;
  isbn?: string;
  pages?: number;
  coverPath?: string;
  coverUrl?: string;
  subjects?: string[];
  publishYear?: number;
}

/**
 * Clean filename to extract a searchable book title.
 * Examples:
 *   "04 Max Planck.pdf" → "Max Planck"
 *   "01-iniciacion humana y solar.pdf" → "iniciacion humana y solar"
 *   "Aceptar para vivir sin sufrir.pdf" → "Aceptar para vivir sin sufrir"
 */
function cleanTitleForSearch(filename: string): string {
  let name = filename
    .replace(/\.(pdf|epub|jpg|jpeg|png|tif|tiff|gif|bmp)$/i, '') // Remove extension
    .replace(/^\d{1,4}[\s\-_.]+/, '')  // Remove leading numbers like "04 " or "01-"
    .replace(/[_]+/g, ' ')             // Underscores to spaces
    .replace(/\s+/g, ' ')             // Normalize spaces
    .trim();
  
  return name;
}

/**
 * Extract the folder category from a file path to use as search context.
 * e.g. "...\CIENCIA\Física Cuántica\05 Feynman.pdf" → "Física Cuántica"
 */
function extractFolderContext(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  // Get the parent folder name (last folder before the file)
  if (parts.length >= 2) {
    const parentFolder = parts[parts.length - 2];
    // Skip generic folder names
    const skipFolders = new Set(['Lectura', '2.000 Libros', 'Documentos', 'OneDrive', 'Users', 'Usuario']);
    if (!skipFolders.has(parentFolder)) {
      return parentFolder;
    }
  }
  return '';
}

/**
 * Search Open Library for book metadata + cover
 */
async function searchOpenLibrary(title: string, author?: string): Promise<EnrichmentResult> {
  try {
    let query = title;
    if (author && author !== '' && author !== 'Autor desconocido') {
      query += ` ${author}`;
    }

    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5&fields=key,title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year,subject`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'BiblioVault/1.0 (Personal Library Manager)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return { found: false, source: 'none' };

    const data = await response.json() as {
      numFound: number;
      docs: Array<{
        title: string;
        author_name?: string[];
        cover_i?: number;
        isbn?: string[];
        number_of_pages_median?: number;
        first_publish_year?: number;
        subject?: string[];
      }>;
    };

    if (!data.docs || data.docs.length === 0) return { found: false, source: 'none' };

    // Find best match — prefer results with cover images
    const bestMatch = data.docs.find(d => d.cover_i) || data.docs[0];

    const coverUrl = bestMatch.cover_i
      ? `https://covers.openlibrary.org/b/id/${bestMatch.cover_i}-L.jpg`
      : undefined;

    return {
      found: true,
      source: 'openlibrary',
      title: bestMatch.title,
      author: bestMatch.author_name?.join(', '),
      isbn: bestMatch.isbn?.[0],
      pages: bestMatch.number_of_pages_median,
      coverUrl,
      subjects: bestMatch.subject?.slice(0, 5),
      publishYear: bestMatch.first_publish_year,
    };
  } catch (err) {
    console.error('Open Library search failed:', err);
    return { found: false, source: 'none' };
  }
}

/**
 * Search Google Books for book metadata + cover
 */
async function searchGoogleBooks(title: string, author?: string): Promise<EnrichmentResult> {
  try {
    let query = `intitle:${title}`;
    if (author && author !== '' && author !== 'Autor desconocido') {
      query += `+inauthor:${author}`;
    }

    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return { found: false, source: 'none' };

    const data = await response.json() as {
      totalItems: number;
      items?: Array<{
        volumeInfo: {
          title: string;
          authors?: string[];
          description?: string;
          industryIdentifiers?: Array<{ type: string; identifier: string }>;
          pageCount?: number;
          imageLinks?: { thumbnail?: string; smallThumbnail?: string };
          categories?: string[];
          publishedDate?: string;
        };
      }>;
    };

    if (!data.items || data.items.length === 0) return { found: false, source: 'none' };

    // Find best match — prefer results with cover images
    const bestMatch = data.items.find(i => i.volumeInfo.imageLinks?.thumbnail) || data.items[0];
    const vol = bestMatch.volumeInfo;

    // Get high-res cover URL (replace zoom=1 for larger image)
    let coverUrl = vol.imageLinks?.thumbnail;
    if (coverUrl) {
      coverUrl = coverUrl.replace('zoom=1', 'zoom=2').replace('&edge=curl', '');
      // Ensure HTTPS
      coverUrl = coverUrl.replace('http://', 'https://');
    }

    const isbn = vol.industryIdentifiers?.find(i => i.type === 'ISBN_13')?.identifier
      || vol.industryIdentifiers?.find(i => i.type === 'ISBN_10')?.identifier;

    return {
      found: true,
      source: 'googlebooks',
      title: vol.title,
      author: vol.authors?.join(', '),
      description: vol.description?.substring(0, 1000),
      isbn,
      pages: vol.pageCount,
      coverUrl,
      subjects: vol.categories?.slice(0, 5),
      publishYear: vol.publishedDate ? parseInt(vol.publishedDate) : undefined,
    };
  } catch (err) {
    console.error('Google Books search failed:', err);
    return { found: false, source: 'none' };
  }
}

/**
 * Download a cover image from URL and save locally
 */
async function downloadCover(url: string, bookId: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'BiblioVault/1.0' },
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());

    // Check if we got actual image data (not a placeholder)
    if (buffer.length < 1000) return null; // Too small = likely placeholder

    const ext = url.includes('.png') ? 'png' : 'jpg';
    const outputPath = join(COVERS_DIR, `${bookId}.${ext}`);
    writeFileSync(outputPath, buffer);

    return outputPath;
  } catch (err) {
    console.error(`Cover download failed for book ${bookId}:`, err);
    return null;
  }
}

/**
 * Main enrichment function — searches APIs and downloads cover.
 * Uses folder context (e.g. "Física Cuántica") to improve search accuracy.
 */
export async function enrichBook(
  bookId: number,
  filename: string,
  currentAuthor?: string,
  filePath?: string,
): Promise<EnrichmentResult> {
  let searchTitle = cleanTitleForSearch(filename);
  
  // For short/ambiguous titles, add folder context
  const folderCtx = filePath ? extractFolderContext(filePath) : '';
  if (folderCtx && searchTitle.split(' ').length <= 2) {
    // Short title like "Feynman" → "Feynman Física Cuántica"
    searchTitle = `${searchTitle} ${folderCtx}`;
    console.log(`📖 Enhanced search: "${searchTitle}" (added folder context)`);
  }

  // 1. Try Open Library first (free, unlimited)
  let result = await searchOpenLibrary(searchTitle, currentAuthor);

  // 2. If no cover from Open Library, try Google Books
  if (!result.found || !result.coverUrl) {
    const googleResult = await searchGoogleBooks(searchTitle, currentAuthor);
    if (googleResult.found) {
      // Merge: keep Open Library data but use Google cover if better
      if (!result.found) {
        result = googleResult;
      } else if (googleResult.coverUrl && !result.coverUrl) {
        result.coverUrl = googleResult.coverUrl;
        result.source = 'googlebooks';
        if (googleResult.description) result.description = googleResult.description;
      }
    }
  }

  // 3. Download the cover if we found one
  if (result.coverUrl) {
    const coverPath = await downloadCover(result.coverUrl, bookId);
    if (coverPath) {
      result.coverPath = coverPath;
    }
  }

  return result;
}

/**
 * Batch enrichment state
 */
export interface BatchEnrichState {
  status: 'idle' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  currentBook: string;
  errors: string[];
}

let batchState: BatchEnrichState = {
  status: 'idle',
  total: 0,
  processed: 0,
  enriched: 0,
  failed: 0,
  currentBook: '',
  errors: [],
};

export function getBatchState(): BatchEnrichState {
  return { ...batchState };
}

export function resetBatchState() {
  batchState = {
    status: 'idle',
    total: 0,
    processed: 0,
    enriched: 0,
    failed: 0,
    currentBook: '',
    errors: [],
  };
}

/**
 * Run batch enrichment on a list of books
 * Throttled to 1 request per second (Open Library rate limit)
 */
export async function runBatchEnrichment(
  books: Array<{ id: number; file_name: string; file_path: string; author: string; enriched: number }>,
  onUpdate: (bookId: number, result: EnrichmentResult) => void,
) {
  const toEnrich = books.filter(b => !b.enriched);

  batchState = {
    status: 'running',
    total: toEnrich.length,
    processed: 0,
    enriched: 0,
    failed: 0,
    currentBook: '',
    errors: [],
  };

  for (const book of toEnrich) {
    if (batchState.status !== 'running') break; // Allow cancellation

    batchState.currentBook = book.file_name;

    try {
      const result = await enrichBook(book.id, book.file_name, book.author, book.file_path);

      if (result.found) {
        onUpdate(book.id, result);
        batchState.enriched++;
      } else {
        batchState.failed++;
      }
    } catch (err) {
      batchState.failed++;
      batchState.errors.push(`${book.file_name}: ${err}`);
    }

    batchState.processed++;

    // Throttle: wait 1.2 seconds between requests
    await new Promise(r => setTimeout(r, 1200));
  }

  batchState.status = 'done';
}

export function cancelBatchEnrichment() {
  batchState.status = 'done';
}
