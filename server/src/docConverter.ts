/**
 * DOC/DOCX → PDF Converter
 * 
 * Uses LibreOffice headless to convert Word documents to PDF for the reader.
 * PDFs are cached on disk so conversion only happens once per book.
 * A semaphore ensures max 1 conversion at a time to protect memory (512MB Render).
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_CACHE_DIR = join(__dirname, '..', 'data', 'pdf-cache');

// Ensure cache directory exists
if (!existsSync(PDF_CACHE_DIR)) {
  mkdirSync(PDF_CACHE_DIR, { recursive: true });
}

// ── LibreOffice Detection ──

let _loAvailable: boolean | null = null;

export function isLibreOfficeAvailable(): boolean {
  if (_loAvailable !== null) return _loAvailable;

  try {
    execSync('soffice --version', { timeout: 5000, stdio: 'pipe' });
    _loAvailable = true;
    console.log('📄 LibreOffice: available ✅');
  } catch {
    _loAvailable = false;
    console.log('📄 LibreOffice: NOT available ⚠️ (DOC files will not be convertible to PDF)');
  }

  return _loAvailable;
}

// ── Conversion Semaphore ──

let converting = false;
const queue: Array<() => void> = [];

async function withConversionLock<T>(fn: () => Promise<T>): Promise<T> {
  if (converting) {
    // Wait in queue
    await new Promise<void>(resolve => queue.push(resolve));
  }
  converting = true;
  try {
    return await fn();
  } finally {
    converting = false;
    // Release next in queue
    if (queue.length > 0) {
      const next = queue.shift()!;
      next();
    }
  }
}

// ── Cache Management ──

function getCachePath(bookId: number): string {
  return join(PDF_CACHE_DIR, `${bookId}.pdf`);
}

/**
 * Check if a cached PDF exists for this book.
 * Returns the path if it exists, null otherwise.
 */
export function getCachedPdf(bookId: number): string | null {
  const cachePath = getCachePath(bookId);
  if (existsSync(cachePath)) {
    // Verify it's not empty/corrupt (at least 1KB)
    try {
      const stats = statSync(cachePath);
      if (stats.size > 1024) return cachePath;
      // Remove corrupt cache
      unlinkSync(cachePath);
    } catch {
      // File stat failed, remove
      try { unlinkSync(cachePath); } catch {}
    }
  }
  return null;
}

// ── Core Conversion ──

/**
 * Convert a DOC/DOCX file to PDF using LibreOffice headless.
 * 
 * @param docPath - Absolute path to the DOC/DOCX file
 * @param bookId - Book ID for cache naming
 * @returns Path to the cached PDF, or null if conversion failed
 */
export async function convertDocToPdf(
  docPath: string,
  bookId: number,
): Promise<string | null> {
  // 1. Check cache first
  const cached = getCachedPdf(bookId);
  if (cached) {
    console.log(`📄 Cache HIT: book ${bookId} → ${cached}`);
    return cached;
  }

  // 2. Check LibreOffice is available
  if (!isLibreOfficeAvailable()) {
    console.error(`📄 Cannot convert book ${bookId}: LibreOffice not installed`);
    return null;
  }

  // 3. Verify source file exists
  if (!existsSync(docPath)) {
    console.error(`📄 Source file not found: ${docPath}`);
    return null;
  }

  // 4. Convert with semaphore (max 1 at a time)
  return withConversionLock(async () => {
    // Double-check cache (another request may have converted while we waited)
    const doubleCheck = getCachedPdf(bookId);
    if (doubleCheck) return doubleCheck;

    const cachePath = getCachePath(bookId);
    const startTime = Date.now();

    try {
      console.log(`📄 Converting book ${bookId}: ${basename(docPath)} → PDF...`);

      // LibreOffice converts to the same directory as the source by default.
      // We use --outdir to specify a temp output location.
      const tmpOutDir = PDF_CACHE_DIR; // Output directly to cache dir

      // Build the command
      const cmd = [
        'soffice',
        '--headless',
        '--norestore',
        '--nofirststartwizard',
        '--convert-to', 'pdf',
        '--outdir', tmpOutDir,
        `"${docPath}"`,
      ].join(' ');

      execSync(cmd, {
        timeout: 60_000, // 60s max
        stdio: 'pipe',
        env: {
          ...process.env,
          HOME: '/tmp', // LibreOffice needs a writable HOME
        },
      });

      // LibreOffice names the output based on the input filename
      const inputBasename = basename(docPath).replace(/\.[^.]+$/, '');
      const loOutputPath = join(tmpOutDir, `${inputBasename}.pdf`);

      if (!existsSync(loOutputPath)) {
        console.error(`📄 LibreOffice produced no output for book ${bookId}`);
        return null;
      }

      // Rename to our cache naming convention
      if (loOutputPath !== cachePath) {
        renameSync(loOutputPath, cachePath);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const sizeMB = (statSync(cachePath).size / 1048576).toFixed(1);
      console.log(`📄 Converted book ${bookId}: ${sizeMB}MB in ${elapsed}s ✅`);

      return cachePath;
    } catch (err: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (err.killed || err.signal === 'SIGTERM') {
        console.error(`📄 Conversion TIMEOUT for book ${bookId} after ${elapsed}s`);
      } else {
        console.error(`📄 Conversion FAILED for book ${bookId} after ${elapsed}s:`, err.message);
      }

      // Clean up any partial output
      try { unlinkSync(cachePath); } catch {}

      return null;
    }
  });
}
