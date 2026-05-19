/**
 * Hermes AI Client — Backend proxy for AI chat completions
 * Supports multiple backends via OpenAI-compatible API:
 *   - Ollama Cloud (when LLM_API_KEY is set) — Gemma 4, etc.
 *   - Groq Cloud (legacy, when GROQ_API_KEY is set) — Llama 3.1 70B
 *   - Local Hermes (fallback) — localhost:8642
 * 
 * All use OpenAI-compatible /v1/chat/completions format.
 * 
 * Features:
 * - Book-aware contextual system prompt
 * - Page text injection for reading context
 * - Web search results injection
 * - Dashboard navigation action instructions
 */

import type { Request, Response } from 'express';

// ── LLM Configuration (auto-detect Cloud vs Local Hermes) ──
// Priority: LLM_API_KEY (generic) > GROQ_API_KEY (legacy) > Local Hermes
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const LLM_API_URL = process.env.LLM_API_URL || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'http://127.0.0.1:8642/v1');
const LLM_MODEL = process.env.LLM_MODEL || 'hermes';

const isCloud = !!LLM_API_KEY;
const CHAT_URL = isCloud
  ? `${LLM_API_URL}/chat/completions`
  : 'http://127.0.0.1:8642/v1/chat/completions';
const HEALTH_URL = isCloud
  ? `${LLM_API_URL}/models`
  : 'http://127.0.0.1:8642/v1/models';

// Log which LLM backend is active
console.log(`🤖 LLM Backend: ${isCloud ? `Cloud (${LLM_API_URL} / ${LLM_MODEL})` : 'Local Hermes (localhost:8642)'}`);

// Export for use by other modules (e.g. aiTitleIdentifier)
export { LLM_API_KEY, LLM_API_URL, LLM_MODEL, isCloud };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Build headers for the LLM API request */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isCloud) {
    headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
  }
  return headers;
}

/** Build a contextual system prompt for book-aware AI conversation */
function buildSystemPrompt(
  bookTitle: string,
  bookAuthor: string,
  pageContext?: string,
  webSearchResults?: string,
  libraryContext?: string,
  userLanguage?: string,
): string {
  const lang = userLanguage === 'en'
    ? 'IMPORTANT: Respond entirely in English.'
    : 'Responde en el mismo idioma que use el usuario.';

  let prompt = `Eres **Hermes**, el guardián del conocimiento en Lectura Arcana, una biblioteca digital esotérica y filosófica. Tu tono es erudito pero accesible, misterioso pero claro. Hablas como un guía que ha leído cada libro de esta biblioteca y conoce sus secretos.

📖 LIBRO ACTUAL: "${bookTitle}"${bookAuthor ? ` — ${bookAuthor}` : ''}
${lang}

CAPACIDADES: Experto en literatura, filosofía, esoterismo, ciencias ocultas y academia. Analizas contenido real del libro cuando se te proporciona. Resumes, explicas, filosofas, generas reportes y relacionas con otros textos. Usas Markdown. Si no sabes algo, lo dices.

MODOS:
- "resumen" → resume el texto proporcionado
- "explicar" → desglosa conceptos clave
- "filosofar" → profundiza implicaciones filosóficas
- "reporte" → análisis estructurado con secciones
- "relacionar" → conecta con otros libros/autores/corrientes

ACCIONES (máx 1 por respuesta, línea propia al final):
@@ACTION:search:término@@ | @@ACTION:category:NOMBRE@@ | @@ACTION:open:ID@@ | @@ACTION:navigate:library|favorites|reading@@

FOLLOW-UPS: Al final de CADA respuesta, sugiere 3 preguntas cortas:
@@FOLLOW_UPS:["Pregunta 1", "Pregunta 2", "Pregunta 3"]@@`;

  if (pageContext) {
    prompt += `\n\n📄 TEXTO DEL LIBRO (contenido real de las páginas actuales):\n---\n${pageContext}\n---\n⚡ Usa este texto como base principal. El usuario lo está leyendo ahora.`;
  } else {
    prompt += `\n\n⚠️ Sin texto extraíble (posible escaneo sin OCR). Usa tu conocimiento sobre "${bookTitle}".`;
  }

  if (webSearchResults) {
    prompt += `\n\n${webSearchResults}\n💡 Complementa con estos resultados web. Cita fuentes.`;
  }

  if (libraryContext) {
    prompt += `\n\n📚 BIBLIOTECA:\n${libraryContext}`;
  }

  return prompt;
}

/** Stream chat completion from LLM (Groq or Hermes) */
export async function streamChat(req: Request, res: Response) {
  const { messages, bookTitle, bookAuthor, pageContext, webSearchResults, libraryContext, userLanguage } = req.body as {
    messages: ChatMessage[];
    bookTitle?: string;
    bookAuthor?: string;
    pageContext?: string;
    webSearchResults?: string;
    libraryContext?: string;
    userLanguage?: string;
  };

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Build full message array with system prompt
  const systemPrompt = buildSystemPrompt(
    bookTitle || 'Unknown Book',
    bookAuthor || '',
    pageContext,
    webSearchResults,
    libraryContext,
    userLanguage,
  );

  // Server-side safeguard: limit history to last 30 messages to prevent token overflow
  const trimmedMessages = messages.length > 30 ? messages.slice(-30) : messages;

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedMessages,
  ];

  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: fullMessages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const backendName = isCloud ? 'Cloud LLM' : 'Hermes';
      res.write(`data: ${JSON.stringify({ error: `${backendName} error: ${response.status} - ${errorText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!response.body) {
      res.write(`data: ${JSON.stringify({ error: 'No response body from LLM' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Pipe the SSE stream directly through
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.end();
  } catch (err) {
    console.error('LLM connection error:', err);
    const hint = isCloud
      ? 'No se pudo conectar con el LLM Cloud. Verifica tu API key y conexión a internet.'
      : 'No se pudo conectar con Hermes AI. Verifica que esté ejecutándose en localhost:8642';
    res.write(`data: ${JSON.stringify({ error: hint })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/** Health check for LLM backend */
export async function checkHermesHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Make a non-streaming LLM call (for summaries, enrichment, etc.) */
export async function llmComplete(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<string | null> {
  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens ?? 500,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('LLM completion error:', err);
    return null;
  }
}

/** Build system prompt specifically for the AI Organizer role */
function buildOrganizerSystemPrompt(libraryContext: string): string {
  return `Eres **Hermes**, el bibliotecario maestro de Lectura Arcana. Tu misión es guiar al lector a través de la biblioteca, descubrir conexiones ocultas entre textos y recomendar lecturas transformadoras.

CAPACIDADES:
- Tienes acceso a libros de la biblioteca del usuario (proporcionados abajo)
- Recomiendas lecturas, agrupas por temática y construyes rutas de aprendizaje
- Tu tono es erudito, perspicaz y misterioso, como un sabio guardián de conocimiento ancestral

TARJETAS VISUALES:
Para mostrar un libro visualmente, incluye: [BOOK_ID:numero_de_id]
Ejemplo: "Te recomiendo esta obra: [BOOK_ID:45]. Cambiará tu perspectiva."
La interfaz mostrará una tarjeta interactiva con portada y botón de leer.

REGLAS IMPORTANTES:
- Recomienda AL MENOS 3 libros con [BOOK_ID:X] cuando sea posible
- Explica brevemente POR QUÉ recomiendas cada libro (conexión temática, complementariedad, etc.)
- Si no hay libros relevantes, sugiere al usuario buscar con otros términos o explorar categorías
- Usa SOLO libros del contexto proporcionado (no inventes IDs)

📚 BIBLIOTECA (libros recuperados):
${libraryContext || 'No se encontraron libros relevantes para esta consulta.'}`;
}

/** Stream chat completion from LLM for the AI Organizer */
export async function streamOrganizerChat(req: Request, res: Response) {
  const { messages, libraryContext } = req.body as {
    messages: ChatMessage[];
    libraryContext: string;
  };

  const systemMessage: ChatMessage = {
    role: 'system',
    content: buildOrganizerSystemPrompt(libraryContext),
  };

  const fullMessages = [systemMessage, ...messages];

  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: fullMessages,
        stream: true,
        temperature: 0.7, // A bit more creative for recommendations
        max_tokens: 2500,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('LLM Error:', err);
      res.write(`data: ${JSON.stringify({ error: 'AI request failed' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!response.body) {
      res.write(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error('LLM proxy error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Internal proxy error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
