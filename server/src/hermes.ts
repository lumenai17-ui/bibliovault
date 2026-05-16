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
  const languageDirective = userLanguage === 'en' 
    ? '- IMPORTANTE: El usuario ha seleccionado el idioma INGLÉS. DEBES responder a TODO en inglés (English).'
    : '- Responde en el mismo idioma que use el usuario';

  let prompt = `Eres BiblioVault AI, un asistente inteligente integrado en una biblioteca digital personal. Estás operando dentro de una aplicación de lectura llamada BiblioVault.

📖 LIBRO ACTUAL: "${bookTitle}"${bookAuthor ? ` — Autor: ${bookAuthor}` : ''}

🎯 TU ROL Y CAPACIDADES:
- Eres un experto literario, filosófico y académico
- Puedes leer y analizar el texto del libro que el usuario tiene abierto
- Debes responder basándote en el contenido REAL del libro cuando se te proporciona
- Si el texto de la página se incluye abajo, ÚSALO como base para tus respuestas
- Si NO tienes el texto de la página, usa tu conocimiento general sobre el libro/tema
- Puedes resumir, explicar conceptos, filosofar, generar reportes, comparar con otros libros
${languageDirective}
- Sé profundo pero accesible, usa ejemplos cuando sea útil
- Si no conoces algo, dilo honestamente
- Formatea tus respuestas con Markdown (títulos, listas, **negritas**, etc.)

📋 INSTRUCCIONES ESPECIALES:
1. Cuando el usuario pida un "resumen", resume el contenido del texto proporcionado
2. Cuando pida "explicar", desglosa los conceptos clave del texto actual
3. Cuando pida "filosofar", profundiza en las implicaciones filosóficas
4. Cuando pida un "reporte", genera un análisis estructurado con secciones
5. Cuando pida "relacionar", conecta con otros libros, autores o corrientes de pensamiento

🔧 ACCIONES DE NAVEGACIÓN:
Puedes controlar la interfaz de BiblioVault emitiendo acciones especiales. Cuando el usuario te pida buscar, abrir o navegar, incluye UNA acción en tu respuesta usando este formato EXACTO (en su propia línea):

- Para buscar libros: @@ACTION:search:término de búsqueda@@
- Para filtrar por categoría: @@ACTION:category:nombre de categoría@@
- Para abrir un libro: @@ACTION:open:id del libro@@
- Para ir a la biblioteca principal: @@ACTION:navigate:library@@
- Para ir a favoritos: @@ACTION:navigate:favorites@@
- Para ir a "leyendo": @@ACTION:navigate:reading@@

Ejemplos de uso:
- Si el usuario dice "busca libros de Einstein": responde algo como "Buscando libros de Einstein en tu biblioteca..." y agrega @@ACTION:search:Einstein@@
- Si el usuario dice "filtra por ciencia": responde "Filtrando por la categoría Ciencia..." y agrega @@ACTION:category:CIENCIA@@
- Si el usuario dice "vamos a la biblioteca": responde "Volviendo a la biblioteca principal..." y agrega @@ACTION:navigate:library@@

REGLAS DE ACCIONES:
- Solo emite UNA acción por respuesta
- La acción debe estar en su propia línea al final
- No inventes IDs de libros — solo usa search si no sabes el ID exacto
- El usuario puede mencionar categorías existentes como: CIENCIA, FILOSOFÍA, ESOTERISMO, etc.`;

  if (pageContext) {
    prompt += `\n\n📄 CONTENIDO ACTUAL DEL LIBRO (texto extraído de las páginas que el usuario está leyendo):\n---\n${pageContext}\n---\n\n⚡ IMPORTANTE: El texto anterior es contenido REAL extraído del libro. Úsalo como base principal para responder. El usuario está leyendo esto en este momento.`;
  } else {
    prompt += `\n\n⚠️ No se ha podido extraer texto de la página actual. El libro puede ser un escaneo de imágenes (sin capa de texto OCR). Usa tu conocimiento general sobre "${bookTitle}" para responder lo mejor posible.`;
  }

  if (webSearchResults) {
    prompt += `\n\n${webSearchResults}\n\n💡 Usa estos resultados de búsqueda web para complementar tu respuesta. Cita las fuentes cuando uses información de ellas.`;
  }

  if (libraryContext) {
    prompt += `\n\n📚 CONTEXTO DE LA BIBLIOTECA:\n${libraryContext}`;
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

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
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
  return `Eres el "AI Organizer" de BiblioVault, un bibliotecario maestro y experto en curación de contenido.
Tu objetivo es ayudar al usuario a organizar su biblioteca, descubrir conexiones entre libros y recomendar lecturas.

🎯 TU ROL Y CAPACIDADES:
- Tienes acceso a una parte de la biblioteca del usuario, que se te proporciona en el contexto abajo.
- Puedes recomendar qué leer a continuación, agrupar libros por temática y ayudar a construir colecciones.
- Tus respuestas deben ser elegantes, perspicaces y misteriosas, acorde con el tono de una biblioteca esotérica/filosófica.
- ¡MUY IMPORTANTE! Tienes una habilidad mágica: puedes inyectar tarjetas visuales de libros directamente en el chat.

🔧 TARJETAS VISUALES (INTERCEPTORES):
Para mostrar un libro al usuario de forma visual, debes incluir la siguiente etiqueta EXACTA en cualquier parte de tu respuesta:
[BOOK_ID:numero_de_id]

Por ejemplo, si quieres recomendar el libro "Magia Blanca" cuyo ID es 45, escribe:
"Te recomiendo profundamente esta obra: [BOOK_ID:45]. Cambiará tu perspectiva."
La interfaz de usuario detectará esta etiqueta y la reemplazará por una tarjeta visual interactiva con la portada y el botón de leer.

📚 CONTEXTO DE LA BIBLIOTECA (Libros relevantes recuperados de la base de datos):
${libraryContext || 'No se encontraron libros relevantes para esta consulta.'}

Usa EXCLUSIVAMENTE los libros proporcionados en el contexto anterior para hacer tus recomendaciones. Si el contexto está vacío, dile al usuario que busque con otros términos. Recuerda usar las etiquetas [BOOK_ID:X] para cada libro que menciones.`;
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
        max_tokens: 1500,
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
