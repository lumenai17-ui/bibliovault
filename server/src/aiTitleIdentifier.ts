/**
 * AI Title Identifier — Uses LLM (Groq Cloud or Hermes) to read the first pages 
 * of a PDF and identify the REAL title and author from the content.
 * 
 * Triple fallback strategy:
 *   1. Text extraction (pdf-parse) → send text to LLM
 *   2. OCR (Tesseract) → send OCR text to LLM  
 *   3. Vision AI (Groq Llama 4 Scout) → send cover IMAGE to vision model
 * 
 * Uses llmComplete from hermes.ts for text-based identification.
 * Uses direct Groq API for vision-based identification.
 */

import { extractPdfText } from './textExtractor.js';
import { llmComplete } from './hermes.js';
import { readFileSync, existsSync } from 'fs';

// Vision model config
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export interface TitleIdentification {
  title: string;
  author: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'ai_text' | 'ai_vision';
}

const TITLE_SYSTEM_PROMPT = `Eres un bibliotecario experto. Tu tarea es identificar el TÍTULO REAL y el AUTOR de un libro.

REGLAS:
- Responde SOLO en formato JSON: {"title": "...", "author": "...", "confidence": "high|medium|low"}
- El título debe ser el nombre COMPLETO del libro como aparece en la portada/portadilla
- El autor debe ser el nombre completo del escritor
- Si hay subtítulo, inclúyelo separado por " — " o ": "
- Si no puedes identificar el autor, usa ""
- "high" = claramente visible, "medium" = inferido, "low" = adivinado
- NO inventes datos. Si no estás seguro, pon confidence "low"
- NO respondas con nada más que el JSON`;

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJsonResponse(content: string): { title?: string; author?: string; confidence?: string } | null {
  try {
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      const rawMatch = content.match(/\{[\s\S]*\}/);
      if (rawMatch) jsonStr = rawMatch[0];
    }
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Use Vision AI to identify title from a cover image.
 * Sends the image (base64) to Groq's Llama 4 Scout vision model.
 */
async function identifyTitleFromImage(
  imagePath: string,
  currentTitle: string,
): Promise<TitleIdentification | null> {
  if (!GROQ_API_KEY) {
    console.log('⚠️ No GROQ_API_KEY — cannot use vision model');
    return null;
  }

  if (!existsSync(imagePath)) {
    console.log(`⚠️ Cover image not found: ${imagePath}`);
    return null;
  }

  try {
    const imageBuffer = readFileSync(imagePath);
    
    // Check size (max 4MB for base64)
    if (imageBuffer.length > 4 * 1024 * 1024) {
      console.log(`⚠️ Image too large for vision (${Math.round(imageBuffer.length / 1024 / 1024)}MB)`);
      return null;
    }

    const base64Image = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    console.log(`👁️ Using Vision AI to read cover of "${currentTitle}"...`);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `El archivo se llama "${currentTitle}". Mira la imagen de la portada/primera página del libro e identifica el título real y autor.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`👁️ Vision API error ${response.status}:`, errText.slice(0, 200));
      return null;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = parseJsonResponse(content);
    if (!parsed?.title) return null;

    console.log(`👁️ Vision identified: "${parsed.title}" by ${parsed.author || '?'} (${parsed.confidence})`);

    return {
      title: parsed.title,
      author: parsed.author || '',
      confidence: (parsed.confidence as 'high' | 'medium' | 'low') || 'medium',
      source: 'ai_vision',
    };
  } catch (err) {
    console.error('Vision AI error:', err);
    return null;
  }
}

/**
 * Use the LLM to identify the real title and author from PDF text content.
 * Triple fallback: Text → OCR → Vision AI
 * 
 * @param coverImagePath - Optional path to cover image for vision fallback
 */
export async function identifyTitleFromPdf(
  filePath: string,
  currentTitle: string,
  coverImagePath?: string,
): Promise<TitleIdentification | null> {
  try {
    // ── Strategy 1: Extract text from first 2 pages ──
    const result = await extractPdfText(filePath, 1, 2);
    let firstPagesText = result.fullText?.trim();

    // ── Strategy 2: OCR fallback ──
    if (!firstPagesText || firstPagesText.length < 20) {
      console.log(`⚠️ No readable text in "${currentTitle}" — trying OCR...`);
      try {
        const { extractOcrText } = await import('./ocrExtractor.js');
        firstPagesText = await extractOcrText(filePath, 2);
      } catch {
        // OCR not available
      }
    }

    // If we have text, use text-based identification
    if (firstPagesText && firstPagesText.length >= 20) {
      const textSample = firstPagesText.substring(0, 1200);

      const userPrompt = `El archivo se llama "${currentTitle}". Aquí está el texto de las primeras páginas del PDF:\n\n---\n${textSample}\n---\n\nIdentifica el título real y autor de este libro.`;

      const content = await llmComplete(TITLE_SYSTEM_PROMPT, userPrompt, {
        temperature: 0.1,
        max_tokens: 200,
      });

      if (content) {
        const parsed = parseJsonResponse(content);
        if (parsed?.title) {
          console.log(`🤖 AI (text) identified: "${parsed.title}" by ${parsed.author || '?'} (${parsed.confidence})`);
          return {
            title: parsed.title,
            author: parsed.author || '',
            confidence: (parsed.confidence as 'high' | 'medium' | 'low') || 'medium',
            source: 'ai_text',
          };
        }
      }
    }

    // ── Strategy 3: Vision AI fallback (for scanned PDFs) ──
    if (coverImagePath) {
      console.log(`📷 Text extraction failed for "${currentTitle}" — trying Vision AI on cover image...`);
      return await identifyTitleFromImage(coverImagePath, currentTitle);
    }

    console.log(`❌ All strategies failed for "${currentTitle}"`);
    return null;
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

    const parsed = parseJsonResponse(content);
    if (!parsed?.title) return null;

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

/**
 * Direct vision-based title identification from an image path.
 * Exported for use by other modules (e.g. cover extraction flow).
 */
export { identifyTitleFromImage };
