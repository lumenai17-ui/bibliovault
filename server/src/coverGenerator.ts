/**
 * Cover Generator — Creates thumbnail covers from PDF first pages
 * Uses pdf-parse + canvas to render the first page as an image.
 * Falls back to a colored placeholder with the book title.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const COVERS_DIR = join(__dirname, '..', 'data', 'covers');

// Ensure covers directory exists
if (!existsSync(COVERS_DIR)) {
  mkdirSync(COVERS_DIR, { recursive: true });
}

/**
 * Generate a cover image for a book.
 * For PDFs, we extract metadata and create a styled SVG-based cover.
 * This approach avoids heavy native dependencies like poppler/mupdf.
 */
export async function generateCover(
  bookId: number,
  filePath: string,
  dbTitle?: string,
  dbAuthor?: string,
): Promise<string | null> {
  const coverPath = join(COVERS_DIR, `${bookId}.svg`);

  // Already generated
  if (existsSync(coverPath)) return coverPath;

  try {
    let title = dbTitle || '';
    let author = dbAuthor || '';
    let pages = 0;

    // Try to get extra metadata from PDF
    if (filePath.toLowerCase().endsWith('.pdf') && existsSync(filePath)) {
      try {
        const { default: pdfParse } = await import('pdf-parse');
        const buffer = readFileSync(filePath);
        const data = await pdfParse(buffer, { max: 1 });
        if (!title && data.info?.Title) title = data.info.Title;
        if (!author && data.info?.Author) author = data.info.Author;
        pages = data.numpages || 0;
      } catch {
        // PDF parse failed, use DB metadata
      }
    }

    const hue = (bookId * 37) % 360;
    const saturation = 40 + (bookId % 30);
    const lightness = 15 + (bookId % 15);

    const svg = createSvgCover(title || 'Libro', author, pages, hue, saturation, lightness);
    writeFileSync(coverPath, svg);
    return coverPath;
  } catch (err) {
    console.error(`Cover generation failed for book ${bookId}:`, err);
    try {
      const hue = (bookId * 37) % 360;
      const svg = createSvgCover(dbTitle || 'Libro', dbAuthor || '', 0, hue, 35, 20);
      writeFileSync(coverPath, svg);
      return coverPath;
    } catch {
      return null;
    }
  }
}

function createSvgCover(
  title: string,
  author: string,
  pages: number,
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const bgColor1 = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const bgColor2 = `hsl(${(hue + 30) % 360}, ${saturation + 10}%, ${lightness + 5}%)`;
  const accentColor = `hsl(${(hue + 180) % 360}, 70%, 60%)`;

  // Truncate title for display
  const displayTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;
  const displayAuthor = author.length > 40 ? author.substring(0, 37) + '...' : author;

  // Word-wrap title into lines
  const titleLines = wrapText(displayTitle || 'PDF', 20);
  const titleY = 180 - (titleLines.length * 18);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="200" height="300">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bgColor1}"/>
      <stop offset="100%" style="stop-color:${bgColor2}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${accentColor};stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:${accentColor};stop-opacity:0.2"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="200" height="300" fill="url(#bg)" rx="4"/>

  <!-- Decorative elements -->
  <rect x="0" y="0" width="200" height="6" fill="url(#accent)"/>
  <rect x="15" y="240" width="170" height="1" fill="url(#accent)" opacity="0.4"/>

  <!-- Geometric accent -->
  <circle cx="160" cy="60" r="35" fill="${accentColor}" opacity="0.08"/>
  <circle cx="40" cy="260" r="25" fill="${accentColor}" opacity="0.06"/>

  <!-- Title -->
  <text x="100" y="${titleY}" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-weight="bold" fill="white">
    ${titleLines.map((line, i) => `<tspan x="100" dy="${i === 0 ? 0 : 20}">${escapeXml(line)}</tspan>`).join('\n    ')}
  </text>

  <!-- Author -->
  ${displayAuthor ? `<text x="100" y="250" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="rgba(255,255,255,0.7)">${escapeXml(displayAuthor)}</text>` : ''}

  <!-- Pages -->
  ${pages > 0 ? `<text x="100" y="275" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="rgba(255,255,255,0.4)">${pages} páginas</text>` : ''}

  <!-- Book spine effect -->
  <rect x="0" y="0" width="8" height="300" fill="rgba(0,0,0,0.15)" rx="4 0 0 4"/>
</svg>`;
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4); // Max 4 lines
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
