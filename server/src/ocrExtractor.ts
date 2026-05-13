/**
 * OCR Extractor — Extracts text from scanned PDFs using Tesseract.js and MuPDF
 * All heavy dependencies are loaded lazily to keep memory low on production.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Extracts text from the first few pages of a scanned PDF using OCR.
 * Very useful for AI title identification when the PDF has no text layer.
 */
export async function extractOcrText(filePath: string, pagesToScan = 2): Promise<string> {
  let worker: any = null;
  let doc: any = null;
  const tempFiles: string[] = [];
  let extractedText = '';

  try {
    // Lazy-load heavy dependencies to avoid memory bloat at startup
    const { createWorker } = await import('tesseract.js');
    const mupdf = await import('mupdf');

    // 1. Initialize Tesseract
    worker = await createWorker('spa'); // Load Spanish language
    
    // 2. Open PDF with MuPDF
    const pdfBuffer = readFileSync(filePath);
    doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
    
    const pageCount = doc.countPages();
    const limit = Math.min(pagesToScan, pageCount);
    
    // 3. Process each page
    for (let i = 0; i < limit; i++) {
      console.log(`OCR scanning page ${i + 1}/${limit}...`);
      
      // Render page to PNG using MuPDF
      const page = doc.loadPage(i);
      // Scale 2x for better OCR accuracy
      const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
      const pngData = pixmap.asPNG();
      
      const tempPngPath = join(tmpdir(), `ocr_temp_${Date.now()}_${i}.png`);
      writeFileSync(tempPngPath, Buffer.from(pngData));
      tempFiles.push(tempPngPath);
      
      // Run OCR on the PNG
      const { data: { text } } = await worker.recognize(tempPngPath);
      extractedText += text + '\n\n';
    }
    
    return extractedText.trim();
  } catch (err) {
    console.error('OCR Extraction failed:', err);
    return '';
  } finally {
    // Cleanup
    if (worker) await worker.terminate();
    
    for (const file of tempFiles) {
      try {
        unlinkSync(file);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}
