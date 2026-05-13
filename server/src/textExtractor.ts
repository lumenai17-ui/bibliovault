/**
 * Text Extractor — Extracts readable text from PDFs for AI context injection.
 * Supports both text-based PDFs and provides page-level extraction.
 */
import { readFileSync, statSync } from 'fs';

interface PageText {
  page: number;
  text: string;
}

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

/** Extract a summary-sized chunk of text (first ~3000 chars) for AI context */
export async function extractBookExcerpt(filePath: string, maxChars = 4000): Promise<string> {
  try {
    const result = await extractPdfText(filePath, 1, 10); // First 10 pages
    let text = result.fullText;

    // Clean up extracted text
    text = text
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
