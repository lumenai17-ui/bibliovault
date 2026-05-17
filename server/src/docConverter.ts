/**
 * DOC/DOCX → PDF Converter (Pure JavaScript — No LibreOffice needed)
 * 
 * Uses mammoth/word-extractor to extract text, then pdf-lib to generate
 * a proper paginated PDF. Cached on disk so conversion happens once.
 * Semaphore ensures max 1 conversion at a time (memory safety).
 */
import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_CACHE_DIR = join(__dirname, '..', 'data', 'pdf-cache');

if (!existsSync(PDF_CACHE_DIR)) {
  mkdirSync(PDF_CACHE_DIR, { recursive: true });
}

// ── Conversion Semaphore ──

let converting = false;
const queue: Array<() => void> = [];

async function withConversionLock<T>(fn: () => Promise<T>): Promise<T> {
  if (converting) {
    await new Promise<void>(resolve => queue.push(resolve));
  }
  converting = true;
  try {
    return await fn();
  } finally {
    converting = false;
    if (queue.length > 0) queue.shift()!();
  }
}

// ── Cache ──

function getCachePath(bookId: number): string {
  return join(PDF_CACHE_DIR, `${bookId}.pdf`);
}

export function getCachedPdf(bookId: number): string | null {
  const cachePath = getCachePath(bookId);
  if (existsSync(cachePath)) {
    try {
      if (statSync(cachePath).size > 500) return cachePath;
      unlinkSync(cachePath);
    } catch {
      try { unlinkSync(cachePath); } catch {}
    }
  }
  return null;
}

// ── PDF Page Constants ──

const PAGE_W = 612;   // US Letter width in points
const PAGE_H = 792;   // US Letter height in points
const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const LINE_HEIGHT = 18;
const FONT_SIZE = 11;
const TITLE_FONT_SIZE = 16;
const HEADING_FONT_SIZE = 13;
const USABLE_W = PAGE_W - MARGIN_X * 2;
const USABLE_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
const LINES_PER_PAGE = Math.floor(USABLE_H / LINE_HEIGHT);

// ── Text Extraction ──

async function extractDocText(filePath: string): Promise<{ text: string; title: string }> {
  const ext = filePath.toLowerCase().split('.').pop();
  let text = '';

  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.default.extractRawText({ path: filePath });
    text = result.value;
  } else if (ext === 'doc') {
    const WordExtractor = (await import('word-extractor')).default;
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(filePath);
    text = extracted.getBody();
  }

  // Try to extract title (first non-empty line)
  const firstLine = text.split('\n').find(l => l.trim().length > 3)?.trim() || 'Document';
  
  return { text, title: firstLine.substring(0, 100) };
}

// ── Word Wrapping ──

function wrapLine(text: string, maxCharsPerLine: number): string[] {
  if (text.length <= maxCharsPerLine) return [text];
  
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines;
}

// ── Core: Generate PDF from text ──

async function generatePdfFromText(
  text: string,
  title: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  
  pdfDoc.setTitle(title);
  pdfDoc.setProducer('BiblioVault AI');

  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  // Approximate max chars per line based on font metrics
  const avgCharWidth = font.widthOfTextAtSize('M', FONT_SIZE) * 0.55;
  const maxCharsPerLine = Math.floor(USABLE_W / avgCharWidth);

  // Split text into paragraphs
  const paragraphs = text.split(/\n/);
  
  // Process all paragraphs into wrapped lines
  interface Line {
    text: string;
    isHeading: boolean;
    isBlank: boolean;
  }
  
  const allLines: Line[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    
    if (trimmed.length === 0) {
      allLines.push({ text: '', isHeading: false, isBlank: true });
      continue;
    }

    // Detect headings: all caps, short, or starts with chapter markers
    const isHeading = (
      (trimmed === trimmed.toUpperCase() && trimmed.length < 80 && trimmed.length > 2) ||
      /^(chapter|capítulo|parte|section|sección)\s/i.test(trimmed) ||
      /^\d+\.\s/.test(trimmed) && trimmed.length < 80
    );

    const wrapped = wrapLine(trimmed, isHeading ? maxCharsPerLine - 5 : maxCharsPerLine);
    for (const line of wrapped) {
      allLines.push({ text: line, isHeading, isBlank: false });
    }
  }

  // Render lines into pages
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;
  let pageNum = 1;
  const textColor = rgb(0.08, 0.08, 0.12);
  const headingColor = rgb(0.1, 0.1, 0.25);
  const pageNumColor = rgb(0.6, 0.6, 0.65);

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];

    // Check if we need a new page
    if (y < MARGIN_BOTTOM + LINE_HEIGHT) {
      // Page number footer
      const pnText = `${pageNum}`;
      const pnWidth = font.widthOfTextAtSize(pnText, 9);
      page.drawText(pnText, {
        x: PAGE_W / 2 - pnWidth / 2,
        y: MARGIN_BOTTOM - 20,
        size: 9,
        font: font,
        color: pageNumColor,
      });
      
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_TOP;
      pageNum++;
    }

    if (line.isBlank) {
      y -= LINE_HEIGHT * 0.6; // Smaller gap for blank lines
      continue;
    }

    if (line.isHeading) {
      y -= LINE_HEIGHT * 0.5; // Extra space before heading
      page.drawText(line.text, {
        x: MARGIN_X,
        y,
        size: HEADING_FONT_SIZE,
        font: fontBold,
        color: headingColor,
        maxWidth: USABLE_W,
      });
      y -= LINE_HEIGHT * 1.3;
    } else {
      page.drawText(line.text, {
        x: MARGIN_X,
        y,
        size: FONT_SIZE,
        font: font,
        color: textColor,
        maxWidth: USABLE_W,
      });
      y -= LINE_HEIGHT;
    }
  }

  // Final page number
  const pnText = `${pageNum}`;
  const pnWidth = font.widthOfTextAtSize(pnText, 9);
  page.drawText(pnText, {
    x: PAGE_W / 2 - pnWidth / 2,
    y: MARGIN_BOTTOM - 20,
    size: 9,
    font: font,
    color: pageNumColor,
  });

  return pdfDoc.save();
}

// ── Main Export ──

/**
 * Convert a DOC/DOCX file to PDF.
 * Uses mammoth/word-extractor + pdf-lib (pure JS, no native deps).
 */
export async function convertDocToPdf(
  docPath: string,
  bookId: number,
): Promise<string | null> {
  // 1. Check cache
  const cached = getCachedPdf(bookId);
  if (cached) {
    console.log(`📄 Cache HIT: book ${bookId}`);
    return cached;
  }

  // 2. Verify source exists
  if (!existsSync(docPath)) {
    console.error(`📄 Source not found: ${docPath}`);
    return null;
  }

  // 3. Convert with semaphore
  return withConversionLock(async () => {
    const doubleCheck = getCachedPdf(bookId);
    if (doubleCheck) return doubleCheck;

    const cachePath = getCachePath(bookId);
    const startTime = Date.now();

    try {
      console.log(`📄 Converting book ${bookId} to PDF...`);

      const { text, title } = await extractDocText(docPath);
      if (!text || text.trim().length < 10) {
        console.error(`📄 No text extracted from book ${bookId}`);
        return null;
      }

      const pdfBytes = await generatePdfFromText(text, title);
      await writeFile(cachePath, pdfBytes);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const sizeMB = (pdfBytes.length / 1048576).toFixed(1);
      console.log(`📄 Converted book ${bookId}: ${sizeMB}MB, ${pdfBytes.length} bytes in ${elapsed}s ✅`);

      return cachePath;
    } catch (err: any) {
      console.error(`📄 Conversion FAILED for book ${bookId}:`, err.message);
      try { unlinkSync(cachePath); } catch {}
      return null;
    }
  });
}

// Backwards compat — no longer needed but keep API stable
export function isLibreOfficeAvailable(): boolean {
  console.log('📄 DOC→PDF converter: using pdf-lib (pure JS, no LibreOffice needed) ✅');
  return true;
}
