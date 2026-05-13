/**
 * AI Title Identifier — Uses LLM (Groq Cloud or Hermes) to read the first pages 
 * of a PDF and identify the REAL title and author from the content.
 * 
 * Uses llmComplete from hermes.ts which auto-routes to Groq or local Hermes.
 */

import { extractPdfText } from './textExtractor.js';
import { llmComplete } from './hermes.js';

export interface TitleIdentification {
  title: string;
  author: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'ai_text';
}

/**
 * Use the LLM to identify the real title and author from PDF text content.
 * Extracts text from the first 3 pages and asks the AI to parse it.
 */
export async function identifyTitleFromPdf(
  filePath: string,
  currentTitle: string,
): Promise<TitleIdentification | null> {
  try {
    // Extract text from first 2 pages
    const result = await extractPdfText(filePath, 1, 2);
    let firstPagesText = result.fullText?.trim();

    if (!firstPagesText || firstPagesText.length < 20) {
      console.log(`⚠️ No readable text in first pages of "${currentTitle}" — trying OCR...`);
      try {
        const { extractOcrText } = await import('./ocrExtractor.js');
        firstPagesText = await extractOcrText(filePath, 2);
      } catch {
        // OCR not available (production without tesseract)
      }
      
      if (!firstPagesText || firstPagesText.length < 20) {
        console.log(`❌ Cannot extract text from "${currentTitle}"`);
        return null;
      }
    }

    // Limit to first 1200 chars to keep prompt small and fast
    const textSample = firstPagesText.substring(0, 1200);

    const systemPrompt = `Eres un bibliotecario experto. Tu tarea es identificar el TÍTULO REAL y el AUTOR de un libro a partir del texto de sus primeras páginas.

REGLAS:
- Responde SOLO en formato JSON: {"title": "...", "author": "...", "confidence": "high|medium|low"}
- El título debe ser el nombre COMPLETO del libro como aparece en la portada/portadilla
- El autor debe ser el nombre completo del escritor
- Si hay subtítulo, inclúyelo separado por " — " o ": "
- Si no puedes identificar el autor, usa ""
- "high" = claramente visible en el texto, "medium" = inferido, "low" = adivinado
- NO inventes datos. Si no estás seguro, pon confidence "low"
- NO respondas con nada más que el JSON`;

    const userPrompt = `El archivo se llama "${currentTitle}". Aquí está el texto de las primeras páginas del PDF:\n\n---\n${textSample}\n---\n\nIdentifica el título real y autor de este libro.`;

    const content = await llmComplete(systemPrompt, userPrompt, {
      temperature: 0.1,
      max_tokens: 200,
    });

    if (!content) return null;

    // Parse JSON response — handle markdown code blocks
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      const rawMatch = content.match(/\{[\s\S]*\}/);
      if (rawMatch) jsonStr = rawMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as { title?: string; author?: string; confidence?: string };

    if (!parsed.title) return null;

    console.log(`🤖 AI identified: "${parsed.title}" by ${parsed.author || '?'} (${parsed.confidence})`);

    return {
      title: parsed.title,
      author: parsed.author || '',
      confidence: (parsed.confidence as 'high' | 'medium' | 'low') || 'medium',
      source: 'ai_text',
    };
  } catch (err) {
    console.error('AI title identification error:', err);
    return null;
  }
}

/**
 * Identify title and author from filename + folder context.
 * Used for non-PDF formats (.doc, .docx, .epub) where text extraction isn't possible.
 */
export async function identifyTitleFromFilename(
  currentTitle: string,
  fileName: string,
  folderCategory: string,
): Promise<TitleIdentification | null> {
  try {
    const systemPrompt = `Eres un bibliotecario experto. Tu tarea es limpiar y mejorar el título de un libro a partir de su nombre de archivo.

REGLAS:
- Responde SOLO en formato JSON: {"title": "...", "author": "...", "confidence": "high|medium|low"}
- Limpia el título: quita extensiones, números de serie, "(z-lib.org)", "PDFDrive", underscores, etc.
- Si el nombre contiene "Author - Title" o "Author_Title", sepáralos
- Capitaliza correctamente (cada palabra con mayúscula inicial en español)
- Si la categoría/carpeta da pistas del tema, úsalas para clarificar
- Si no puedes mejorar significativamente el título, devuelve confidence "low"
- NO inventes datos`;

    const userPrompt = `Archivo: "${fileName}"\nTítulo actual en la DB: "${currentTitle}"\nCategoría/carpeta: "${folderCategory}"\n\nIdentifica el título real y autor de este libro basándote en el nombre del archivo.`;

    const content = await llmComplete(systemPrompt, userPrompt, {
      temperature: 0.1,
      max_tokens: 200,
    });

    if (!content) return null;

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      const rawMatch = content.match(/\{[\s\S]*\}/);
      if (rawMatch) jsonStr = rawMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as { title?: string; author?: string; confidence?: string };
    if (!parsed.title) return null;

    console.log(`🤖 AI (filename) identified: "${parsed.title}" by ${parsed.author || '?'} (${parsed.confidence})`);

    return {
      title: parsed.title,
      author: parsed.author || '',
      confidence: (parsed.confidence as 'high' | 'medium' | 'low') || 'medium',
      source: 'ai_text',
    };
  } catch (err) {
    console.error('AI filename identification error:', err);
    return null;
  }
}
