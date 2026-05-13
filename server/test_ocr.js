import { createWorker } from 'tesseract.js';
import * as mupdf from 'mupdf';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function testOCR() {
  console.log('Starting OCR test...');
  const start = Date.now();

  // Initialize Tesseract worker
  const worker = await createWorker('spa'); // Spanish

  // Load a PDF
  const pdfPath = 'C:\\Users\\Usuario\\OneDrive\\Documentos\\Lectura\\Albert Einstein - Sobre la teoría de la relatividad especial y general.pdf';
  const pdfBuffer = readFileSync(pdfPath);
  
  // Render page 1 (cover) to PNG using mupdf
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const page = doc.loadPage(1); // Page 2 usually has text
  const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  const pngData = pixmap.asPNG();
  const pngPath = join(process.cwd(), 'test_ocr_page.png');
  writeFileSync(pngPath, Buffer.from(pngData));

  console.log('Page rendered to PNG in', Date.now() - start, 'ms');

  // Run OCR
  const ocrStart = Date.now();
  const { data: { text } } = await worker.recognize(pngPath);
  
  console.log('OCR completed in', Date.now() - ocrStart, 'ms');
  console.log('Text extracted:', text.substring(0, 200).replace(/\n/g, ' '));

  await worker.terminate();
}

testOCR().catch(console.error);
