/**
 * Web Search — Lightweight web search via DuckDuckGo HTML.
 * Used by the AI chat to find information about books, authors, and topics.
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search DuckDuckGo and extract results from the HTML response.
 * No API key required — uses the HTML endpoint.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BiblioVault-AI/1.0 (Library Assistant)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return [];

    const html = await response.text();
    const results: SearchResult[] = [];

    // Parse results from DuckDuckGo HTML
    // Each result block contains a result__body div with:
    //   h2.result__title > a.result__a (title + URL)
    //   a.result__snippet (snippet text)
    const resultBlocks = html.split('class="result results_links');

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i];

      // Extract title and URL from h2.result__title > a.result__a
      const titleMatch = block.match(/class="result__a"\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      // Extract snippet from a.result__snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (titleMatch) {
        const rawUrl = titleMatch[1];
        const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim()
          : '';

        // DuckDuckGo wraps URLs in a redirect — extract the real URL
        let finalUrl = rawUrl;
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          finalUrl = decodeURIComponent(uddgMatch[1]);
        }

        if (title && snippet) {
          results.push({ title, url: finalUrl, snippet });
        }
      }
    }

    return results;
  } catch (err) {
    console.error('Web search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Format search results as a context string for the AI.
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '';

  let text = '🌐 RESULTADOS DE BÚSQUEDA WEB:\n';
  for (let i = 0; i < results.length; i++) {
    text += `\n${i + 1}. **${results[i].title}**\n`;
    text += `   ${results[i].snippet}\n`;
    text += `   Fuente: ${results[i].url}\n`;
  }
  return text;
}
