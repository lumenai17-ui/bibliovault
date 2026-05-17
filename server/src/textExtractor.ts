/**
 * Text Extractor — Extracts readable text from PDFs, DOC/DOCX, and EPUB for AI context injection.
 * Supports page-level extraction for all formats.
 */
import { readFileSync, statSync } from 'fs';
import AdmZip from 'adm-zip';

interface PageText {
  page: number;
  text: string;
}

// ── PDF Text Extraction ──

/** Extract text from a specific page range of a PDF */
export async function extractPdfText(
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<{ pages: PageText[]; totalPages: number; fullText: string }> {
  try {
    // Guard: skip huge PDFs to avoid OOM
    const fileSize = statSync(filePath).size;
    if (fileSize > 50_000_000) {
      console.log(`⚠️ PDF too large for text extraction: ${Math.round(fileSize / 1048576)}MB — skipping`);
      return { pages: [], totalPages: 0, fullText: '' };
    }

    const { default: pdfParse } = await import('pdf-parse');
    const buffer = readFileSync(filePath);

    // Custom page render to extract per-page text
    let pageTexts: PageText[] = [];
    let currentPage = 0;

    const options: Record<string, unknown> = {
      // Custom page render function to capture per-page text
      pagerender: async (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) => {
        currentPage++;
        const textContent = await pageData.getTextContent();
        const text = textContent.items.map((item: { str: string }) => item.str).join(' ');
        pageTexts.push({ page: currentPage, text: text.trim() });
        return text;
      },
    };

    const data = await pdfParse(buffer, options);

    // Filter to requested page range
    if (startPage || endPage) {
      const start = startPage || 1;
      const end = endPage || data.numpages;
      pageTexts = pageTexts.filter((p) => p.page >= start && p.page <= end);
    }

    return {
      pages: pageTexts,
      totalPages: data.numpages,
      fullText: pageTexts.map((p) => p.text).join('\n\n'),
    };
  } catch (err) {
    console.error('PDF text extraction error:', err);
    return { pages: [], totalPages: 0, fullText: '' };
  }
}

// ── DOC/DOCX Text Extraction ──

const CHARS_PER_PAGE = 3000; // Virtual page size for text-based formats

/** Extract text from a DOC or DOCX file, split into virtual pages */
export async function extractDocText(
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<{ pages: PageText[]; totalPages: number; fullText: string }> {
  try {
    const ext = filePath.toLowerCase().split('.').pop();
    let fullText = '';

    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.default.extractRawText({ path: filePath });
      fullText = result.value;
    } else if (ext === 'doc') {
      const WordExtractor = (await import('word-extractor')).default;
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      fullText = extracted.getBody();
    } else {
      return { pages: [], totalPages: 0, fullText: '' };
    }

    // Split into virtual pages
    return splitTextIntoPages(fullText, startPage, endPage);
  } catch (err) {
    console.error('DOC text extraction error:', err);
    return { pages: [], totalPages: 0, fullText: '' };
  }
}

// ── EPUB Text Extraction ──

/** Extract text from an EPUB file by reading its spine chapters */
export async function extractEpubText(
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<{ pages: PageText[]; totalPages: number; fullText: string }> {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    // 1. Find the OPF file (content.opf) via container.xml
    const containerEntry = zipEntries.find(e => e.entryName === 'META-INF/container.xml');
    if (!containerEntry) return { pages: [], totalPages: 0, fullText: '' };

    const containerXml = containerEntry.getData().toString('utf8');
    const rootFileMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootFileMatch) return { pages: [], totalPages: 0, fullText: '' };

    const opfPath = rootFileMatch[1];
    const opfEntry = zipEntries.find(e => e.entryName === opfPath);
    if (!opfEntry) return { pages: [], totalPages: 0, fullText: '' };

    const opfContent = opfEntry.getData().toString('utf8');
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // 2. Parse spine to get chapter order
    const spineMatches = [...opfContent.matchAll(/<itemref\s+idref="([^"]+)"/g)];
    const manifestMatches = [...opfContent.matchAll(/<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*/g)];

    const manifest = new Map<string, string>();
    for (const m of manifestMatches) {
      manifest.set(m[1], m[2]);
    }

    // 3. Read each spine chapter and extract text
    let allText = '';
    for (const spine of spineMatches) {
      const href = manifest.get(spine[1]);
      if (!href) continue;

      const chapterPath = opfDir + decodeURIComponent(href);
      const entry = zipEntries.find(e => e.entryName === chapterPath);
      if (!entry) continue;

      const chapterHtml = entry.getData().toString('utf8');
      // Strip HTML tags to get plain text
      const text = chapterHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#?\w+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 20) {
        allText += text + '\n\n';
      }
    }

    return splitTextIntoPages(allText, startPage, endPage);
  } catch (err) {
    console.error('EPUB text extraction error:', err);
    return { pages: [], totalPages: 0, fullText: '' };
  }
}

// ── Shared Utilities ──

/** Split a long text string into virtual pages of ~CHARS_PER_PAGE characters */
function splitTextIntoPages(
  fullText: string,
  startPage?: number,
  endPage?: number,
): { pages: PageText[]; totalPages: number; fullText: string } {
  if (!fullText || fullText.trim().length === 0) {
    return { pages: [], totalPages: 0, fullText: '' };
  }

  const allPages: PageText[] = [];
  let offset = 0;
  let pageNum = 1;

  while (offset < fullText.length) {
    let end = Math.min(offset + CHARS_PER_PAGE, fullText.length);

    // Try to break at a paragraph or sentence boundary
    if (end < fullText.length) {
      // Look for paragraph break
      const paraBreak = fullText.lastIndexOf('\n\n', end);
      if (paraBreak > offset + CHARS_PER_PAGE * 0.6) {
        end = paraBreak + 2;
      } else {
        // Look for sentence break
        const sentenceBreak = fullText.lastIndexOf('. ', end);
        if (sentenceBreak > offset + CHARS_PER_PAGE * 0.6) {
          end = sentenceBreak + 2;
        }
      }
    }

    allPages.push({
      page: pageNum,
      text: fullText.substring(offset, end).trim(),
    });

    offset = end;
    pageNum++;
  }

  // Filter to requested range
  let filteredPages = allPages;
  if (startPage || endPage) {
    const start = startPage || 1;
    const end = endPage || allPages.length;
    filteredPages = allPages.filter(p => p.page >= start && p.page <= end);
  }

  return {
    pages: filteredPages,
    totalPages: allPages.length,
    fullText: filteredPages.map(p => p.text).join('\n\n'),
  };
}

/** Extract a summary-sized chunk of text (first ~3000 chars) for AI context */
export async function extractBookExcerpt(filePath: string, maxChars = 4000): Promise<string> {
  try {
    const ext = filePath.toLowerCase().split('.').pop();
    let result: { fullText: string };

    if (ext === 'doc' || ext === 'docx') {
      result = await extractDocText(filePath, 1, 3);
    } else if (ext === 'epub') {
      result = await extractEpubText(filePath, 1, 3);
    } else {
      result = await extractPdfText(filePath, 1, 10);
    }

    let text = result.fullText
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + '...';
    }

    return text;
  } catch {
    return '';
  }
}

/** Quick check if a PDF has extractable text (not a scan) */
export async function isPdfTextBased(filePath: string): Promise<boolean> {
  try {
    const result = await extractPdfText(filePath, 1, 3);
    const totalText = result.pages.map((p) => p.text).join('');
    return totalText.replace(/\s/g, '').length > 100;
  } catch {
    return false;
  }
}
