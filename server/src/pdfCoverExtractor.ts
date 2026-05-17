/**
 * PDF Cover Extractor — Renders the first page of a PDF as a JPEG image.
 * 
 * Strategy (in order):
 * 1. Render first page using MuPDF (WASM) → high-quality cover for ALL PDFs
 * 2. Fallback: scan binary for embedded JPEG streams (for edge cases)
 * 3. For IMG-type books: resize the first image as cover using sharp
 * 
 * Dependencies: mupdf (WASM, zero native deps), sharp
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = join(__dirname, '..', 'data', 'covers');

if (!existsSync(COVERS_DIR)) mkdirSync(COVERS_DIR, { recursive: true });

// ─── PDF Rendering via MuPDF (WASM) ───

/**
 * Render the first page of a PDF to a JPEG buffer using MuPDF.
 * Works with ALL PDFs — text-based, scanned, vector graphics, etc.
 */
async function renderPdfFirstPage(pdfPath: string, targetWidth = 400): Promise<Buffer | null> {
  try {
    const mupdf = await import('mupdf');

    const fileBuffer = readFileSync(pdfPath);
    // Skip huge PDFs to avoid OOM on 512MB servers
    if (fileBuffer.length > 50_000_000) {
      console.log(`⚠️ PDF too large for cover render: ${Math.round(fileBuffer.length / 1048576)}MB — skipping MuPDF`);
      return null;
    }
    const doc = mupdf.Document.openDocument(fileBuffer, 'application/pdf');

    if (doc.countPages() === 0) return null;

    const page = doc.loadPage(0);
    const bounds = page.getBounds();
    const pageWidth = bounds[2] - bounds[0];

    if (pageWidth <= 0) return null;

    const scale = targetWidth / pageWidth;
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
    );

    // Get PNG from mupdf, then convert to JPEG via sharp for smaller size
    const pngData = pixmap.asPNG();

    try {
      const sharp = (await import('sharp')).default;
      const jpegBuffer = await sharp(Buffer.from(pngData))
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      return jpegBuffer as unknown as Buffer;
    } catch {
      // If sharp fails, return the PNG directly
      return Buffer.from(pngData);
    }
  } catch (err) {
    console.error(`MuPDF render failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Fallback: Binary JPEG Extraction ───

/**
 * Extract the largest JPEG image embedded in the first portion of a PDF file.
 * Works for scanned PDFs that contain raw JPEG streams.
 */
function extractJpegFromPdf(pdfBuffer: Buffer): Buffer | null {
  const scanLimit = Math.min(pdfBuffer.length, 5_000_000); // Reduced from 10MB to 5MB for memory safety

  let bestJpeg: Buffer | null = null;
  let bestSize = 0;
  let searchFrom = 0;

  while (searchFrom < scanLimit - 3) {
    let startIdx = -1;
    for (let i = searchFrom; i < scanLimit - 3; i++) {
      if (pdfBuffer[i] === 0xFF && pdfBuffer[i + 1] === 0xD8 && pdfBuffer[i + 2] === 0xFF) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) break;

    let endIdx = -1;
    for (let i = startIdx + 3; i < scanLimit - 1; i++) {
      if (pdfBuffer[i] === 0xFF && pdfBuffer[i + 1] === 0xD9) {
        endIdx = i + 2;
        break;
      }
    }

    if (endIdx === -1) {
      searchFrom = startIdx + 3;
      continue;
    }

    const size = endIdx - startIdx;
    if (size > 2000 && size > bestSize && size < 50_000_000) {
      bestJpeg = Buffer.from(pdfBuffer.subarray(startIdx, endIdx));
      bestSize = size;
    }

    searchFrom = endIdx;
    if (bestSize > 100_000) break;
  }

  return bestJpeg;
}

// ─── EPUB Cover Extraction ───

/**
 * Extracts the cover image from an EPUB file
 */
export async function extractEpubCover(filePath: string, bookId: number): Promise<string | null> {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    const containerEntry = zipEntries.find(e => e.entryName === 'META-INF/container.xml');
    if (!containerEntry) return null;
    
    const containerXml = containerEntry.getData().toString('utf8');
    const rootFileMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootFileMatch) return null;
    
    const opfPath = rootFileMatch[1];
    const opfEntry = zipEntries.find(e => e.entryName === opfPath);
    if (!opfEntry) return null;
    
    const opfContent = opfEntry.getData().toString('utf8');
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    
    let coverImagePath: string | null = null;
    
    const metaCoverMatch = opfContent.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (metaCoverMatch) {
      const coverId = metaCoverMatch[1];
      const itemRegex = new RegExp(`<item[^>]*id=["']${coverId}["'][^>]*href=["']([^"']+)["'][^>]*>`, 'i');
      const itemMatch = opfContent.match(itemRegex);
      if (itemMatch) coverImagePath = opfDir + itemMatch[1];
    }
    
    if (!coverImagePath) {
      const propMatch = opfContent.match(/<item[^>]*href=["']([^"']+)["'][^>]*properties=["'][^>]*cover-image[^>]*["'][^>]*>/i);
      if (propMatch) coverImagePath = opfDir + propMatch[1];
    }
    
    if (!coverImagePath) {
      const guessMatch = opfContent.match(/<item[^>]*href=["']([^"']+(cover|front)[^"']*\.(jpg|jpeg|png))["'][^>]*>/i);
      if (guessMatch) coverImagePath = opfDir + guessMatch[1];
    }

    if (!coverImagePath) return null;

    const decodedPath = decodeURIComponent(coverImagePath);
    const coverEntry = zipEntries.find(e => e.entryName === decodedPath || e.entryName === coverImagePath);
    
    if (!coverEntry) return null;
    
    const ext = coverImagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const outPath = join(COVERS_DIR, `${bookId}_epub.${ext}`);
    
    writeFileSync(outPath, coverEntry.getData());
    return outPath;
  } catch (err) {
    console.error('EPUB cover extraction error:', err);
    return null;
  }
}

// ─── Image Book Cover ───

/**
 * Create a cover for an image-type book by resizing its first image.
 */
async function createImageBookCover(firstImagePath: string, bookId: number): Promise<string | null> {
  if (!existsSync(firstImagePath)) return null;

  try {
    const sharp = (await import('sharp')).default;
    const outputPath = join(COVERS_DIR, `${bookId}.jpg`);

    await sharp(firstImagePath)
      .resize(400, 600, { fit: 'cover', position: 'top' })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    console.log(`✅ IMG cover created for book ${bookId}`);
    return outputPath;
  } catch (err) {
    console.error(`IMG cover failed for book ${bookId}:`, err);
    return null;
  }
}

// ─── Main Export ───

/**
 * Extract/render the cover from a PDF file.
 * Tries MuPDF rendering first, then falls back to binary JPEG extraction.
 * Returns the output file path if successful, null otherwise.
 */
export async function extractPdfCover(
  pdfPath: string,
  bookId: number,
): Promise<string | null> {
  const outputPath = join(COVERS_DIR, `${bookId}_pdf.jpg`);

  if (!existsSync(pdfPath)) return null;

  try {
    // Strategy 1: Render with MuPDF (works with ALL PDFs)
    const rendered = await renderPdfFirstPage(pdfPath, 400);
    if (rendered && rendered.length > 1000) {
      await writeFile(outputPath, rendered);
      console.log(`✅ PDF cover rendered (MuPDF): book ${bookId} (${Math.round(rendered.length / 1024)}KB)`);
      return outputPath;
    }

    // Strategy 2: Extract embedded JPEG (fallback for edge cases)
    // Only attempt if file < 30MB to avoid OOM
    const fileStats = statSync(pdfPath);
    if (fileStats.size < 30_000_000) {
      const pdfBuffer = readFileSync(pdfPath);
      const jpegBuffer = extractJpegFromPdf(pdfBuffer);
      if (jpegBuffer) {
        await writeFile(outputPath, jpegBuffer);
        console.log(`✅ PDF cover extracted (JPEG stream): book ${bookId} (${Math.round(jpegBuffer.length / 1024)}KB)`);
        return outputPath;
      }
    } else {
      console.log(`⚠️ Skipping JPEG scan for book ${bookId}: file too large (${Math.round(fileStats.size / 1048576)}MB)`);
    }

    console.log(`⚠️ Could not extract cover for book ${bookId}`);
    return null;
  } catch (err) {
    console.error(`PDF cover extraction failed for book ${bookId}:`, err);
    return null;
  }
}

/**
 * Extract cover for an image-type book (uses first image in the collection).
 */
export async function extractImageCover(
  firstImagePath: string,
  bookId: number,
): Promise<string | null> {
  return createImageBookCover(firstImagePath, bookId);
}

// ─── Batch Cover Extraction ───

export interface CoverBatchState {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  total: number;
  processed: number;
  extracted: number;
  failed: number;
  currentBook: string;
  errors: string[];
}

let batchCoverState: CoverBatchState = {
  status: 'idle',
  total: 0,
  processed: 0,
  extracted: 0,
  failed: 0,
  currentBook: '',
  errors: [],
};

let cancelCoverBatch = false;

export function getCoverBatchState(): CoverBatchState {
  return { ...batchCoverState };
}

export function cancelCoverBatchJob(): void {
  cancelCoverBatch = true;
}

export function resetCoverBatchState(): void {
  batchCoverState = {
    status: 'idle',
    total: 0,
    processed: 0,
    extracted: 0,
    failed: 0,
    currentBook: '',
    errors: [],
  };
  cancelCoverBatch = false;
}

/**
 * Run batch cover extraction for books without real covers (those with SVG placeholders).
 * @param books Array of {id, file_path, file_name, format, cover_source}
 * @param onCoverExtracted Callback when a cover is successfully extracted
 */
export async function runBatchCoverExtraction(
  books: Array<{ id: number; file_path: string; file_name: string; format: string; cover_source: string }>,
  onCoverExtracted: (bookId: number, coverPath: string, source: string) => void,
): Promise<void> {
  cancelCoverBatch = false;
  batchCoverState = {
    status: 'running',
    total: books.length,
    processed: 0,
    extracted: 0,
    failed: 0,
    currentBook: '',
    errors: [],
  };

  for (const book of books) {
    if (cancelCoverBatch) {
      batchCoverState.status = 'cancelled';
      return;
    }

    batchCoverState.currentBook = book.file_name;

    try {
      let coverPath: string | null = null;
      let source = '';

      if (book.format === 'pdf') {
        coverPath = await extractPdfCover(book.file_path, book.id);
        source = 'pdf';
      } else if (book.format === 'epub') {
        coverPath = await extractEpubCover(book.file_path, book.id);
        source = 'epub';
      } else if (book.format === 'doc' || book.format === 'docx') {
        coverPath = await extractDocCover(book.file_path, book.id);
        source = 'doc';
      } else if (book.format === 'image') {
        coverPath = await extractImageCover(book.file_path, book.id);
        source = 'image';
      }

      if (coverPath) {
        batchCoverState.extracted++;
        onCoverExtracted(book.id, coverPath, source);
      } else {
        batchCoverState.failed++;
      }
    } catch (err) {
      batchCoverState.failed++;
      const msg = `Book ${book.id}: ${err instanceof Error ? err.message : String(err)}`;
      batchCoverState.errors.push(msg);
      if (batchCoverState.errors.length > 50) batchCoverState.errors.shift();
    }

    batchCoverState.processed++;

    // Delay between books to let GC reclaim memory (production safety)
    const memUsage = process.memoryUsage();
    const heapMB = Math.round(memUsage.heapUsed / 1048576);
    if (heapMB > 300) {
      console.log(`⚠️ High memory (${heapMB}MB) — pausing batch for 3s`);
      await new Promise((r) => setTimeout(r, 3000));
      if (global.gc) global.gc();
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  batchCoverState.status = 'done';
}

export { COVERS_DIR };
