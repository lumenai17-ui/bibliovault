const API_BASE = 'http://localhost:3001/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** Check if Hermes is online */
export async function checkAiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/ai/health`);
    const data = await res.json();
    return data.online;
  } catch {
    return false;
  }
}

/** Search the web for AI context enrichment */
export async function searchWebForAi(query: string): Promise<{ formatted: string; count: number }> {
  try {
    const res = await fetch(`${API_BASE}/ai/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { formatted: '', count: 0 };
    return res.json();
  } catch {
    return { formatted: '', count: 0 };
  }
}

/** AI Navigation Action types */
export interface AiAction {
  type: 'search' | 'category' | 'open' | 'navigate';
  value: string;
}

/** Parse AI actions from response text (@@ACTION:type:value@@) */
export function parseAiActions(text: string): { cleanText: string; actions: AiAction[] } {
  const actions: AiAction[] = [];
  const cleanText = text.replace(/@@ACTION:(\w+):([^@]+)@@/g, (_match, type, value) => {
    if (['search', 'category', 'open', 'navigate'].includes(type)) {
      actions.push({ type: type as AiAction['type'], value: value.trim() });
    }
    return ''; // Remove action tags from displayed text
  }).trim();

  return { cleanText, actions };
}

/** Stream AI chat response from Hermes via the backend proxy */
export async function streamAiChat(
  messages: { role: string; content: string }[],
  bookTitle: string,
  bookAuthor: string,
  pageContext: string | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
  webSearchResults?: string,
  libraryContext?: string,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        bookTitle,
        bookAuthor,
        pageContext,
        webSearchResults,
        libraryContext,
      }),
      signal,
    });

    if (!response.ok) {
      onError(`Error ${response.status}: ${await response.text()}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError('No response stream');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onDone();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              onToken(delta);
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    }

    onDone();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      onDone();
      return;
    }
    onError(err instanceof Error ? err.message : 'Connection failed');
  }
}
