const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

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

/** Parse AI actions from response text (@@ACTION:type:value@@ and @@FOLLOW_UPS:[...]@@) */
export function parseAiActions(text: string): { cleanText: string; actions: AiAction[]; followUps: string[] } {
  const actions: AiAction[] = [];
  let followUps: string[] = [];
  
  let cleanText = text.replace(/@@FOLLOW_UPS:(\[.*?\])@@/g, (_match, jsonArray) => {
    try {
      const parsed = JSON.parse(jsonArray);
      if (Array.isArray(parsed)) {
        followUps = parsed.filter(i => typeof i === 'string');
      }
    } catch (e) {
      console.error('Failed to parse follow-ups', e);
    }
    return '';
  });

  cleanText = cleanText.replace(/@@ACTION:(\w+):([^@]+)@@/g, (_match, type, value) => {
    if (['search', 'category', 'open', 'navigate'].includes(type)) {
      actions.push({ type: type as AiAction['type'], value: value.trim() });
    }
    return ''; // Remove action tags from displayed text
  }).trim();

  return { cleanText: cleanText.trim(), actions, followUps };
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
  userLanguage?: string,
  onUsage?: (usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number }) => void,
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
        userLanguage,
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
            if (parsed.usage && onUsage) {
              onUsage(parsed.usage);
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

/** D1: Log token usage for a single AI interaction */
export async function logAiUsage(bookId: number, usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): Promise<void> {
  try {
    await fetch(`${API_BASE}/ai/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ book_id: bookId, ...usage }),
    });
  } catch {
    // Silent fail — usage logging is non-critical
  }
}

/** D1: Get AI usage dashboard data */
export async function getAiUsage(): Promise<{ today: { tokens: number; messages: number }; total: { tokens: number; messages: number } }> {
  try {
    const res = await fetch(`${API_BASE}/ai/usage`, { credentials: 'include' });
    return res.json();
  } catch {
    return { today: { tokens: 0, messages: 0 }, total: { tokens: 0, messages: 0 } };
  }
}

/** D4: Research mode — parallel web + library search */
export async function aiResearch(query: string): Promise<{ web: { formatted: string; count: number }; library: { formatted: string; count: number } }> {
  try {
    const res = await fetch(`${API_BASE}/ai/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { web: { formatted: '', count: 0 }, library: { formatted: '', count: 0 } };
    return res.json();
  } catch {
    return { web: { formatted: '', count: 0 }, library: { formatted: '', count: 0 } };
  }
}
