const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

// ── Resilient fetch with retry + error handling ──

export class ApiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConnectionError';
  }
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2,
  backoffMs = 1000,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (res.ok || res.status < 500) return res; // Don't retry client errors
      
      // Server error — retry
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      throw new ApiConnectionError(
        err instanceof Error && err.name === 'AbortError'
          ? 'El servidor no respondió a tiempo. Verifica tu conexión.'
          : 'No se pudo conectar al servidor. ¿Está activo el servicio?'
      );
    }
  }
  throw new ApiConnectionError('No se pudo conectar después de varios intentos.');
}

/** Check server health */
export async function checkHealth(): Promise<{
  status: string;
  uptime: number;
  services: Record<string, string>;
  memory: { used: number; total: number; rss: number };
}> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export interface ApiBook {
  id: number;
  title: string;
  author: string;
  description: string;
  isbn: string;
  language: string;
  pages: number;
  format: string;
  content_type: string;
  file_path: string;
  file_name: string;
  file_size: number;
  cover_path: string;
  category_id: number | null;
  category_name: string | null;
  subcategory: string;
  tags: string;
  date_added: string;
  last_read: string | null;
  reading_progress: number;
  favorite: number;
  ocr_status: string;
  ai_summary: string | null;
  folder_category: string;
}

export interface ApiCategory {
  id: number;
  name: string;
  parent_id: number | null;
  ai_suggested: number;
  book_count: number;
}

export interface ScanStatus {
  status: 'idle' | 'scanning' | 'extracting' | 'done' | 'error';
  total: number;
  processed: number;
  currentFile: string;
  newBooks: number;
  skipped: number;
  errors: string[];
}

export interface LibraryStats {
  total: number;
  favorites: number;
  reading: number;
  categories: number;
  byFormat: Record<string, number>;
}

export async function fetchBooks(params: {
  limit?: number;
  offset?: number;
  format?: string;
  category_id?: number;
  favorite?: boolean;
  search?: string;
  collection_id?: number;
} = {}): Promise<{ books: ApiBook[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.format && params.format !== 'all') qs.set('format', params.format);
  if (params.category_id) qs.set('category_id', String(params.category_id));
  if (params.favorite) qs.set('favorite', 'true');
  if (params.search) qs.set('search', params.search);
  if (params.collection_id) qs.set('collection_id', String(params.collection_id));

  const res = await fetchWithRetry(`${API_BASE}/books?${qs}`);
  return res.json();
}

export async function fetchBook(id: number): Promise<ApiBook> {
  const res = await fetchWithRetry(`${API_BASE}/books/${id}`);
  return res.json();
}

export async function updateBook(id: number, updates: Record<string, unknown>): Promise<void> {
  await fetch(`${API_BASE}/books/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  const res = await fetchWithRetry(`${API_BASE}/categories`);
  return res.json();
}

export async function fetchStats(): Promise<LibraryStats> {
  const res = await fetchWithRetry(`${API_BASE}/stats`);
  return res.json();
}

export async function startScan(): Promise<void> {
  await fetch(`${API_BASE}/scan`, { method: 'POST' });
}

export async function fetchScanStatus(): Promise<ScanStatus> {
  const res = await fetch(`${API_BASE}/scan/status`);
  return res.json();
}

export function getBookFileUrl(id: number): string {
  return `${API_BASE}/books/${id}/file`;
}

// Session-based cache buster — changes on each page refresh
const SESSION_ID = Date.now();

export function getBookCoverUrl(id: number, bustCache?: number): string {
  const v = bustCache || SESSION_ID;
  return `${API_BASE}/books/${id}/cover?v=${v}`;
}

export async function fetchBookText(id: number, startPage?: number, endPage?: number): Promise<{
  pages: { page: number; text: string }[];
  totalPages: number;
  fullText: string;
}> {
  const qs = new URLSearchParams();
  if (startPage) qs.set('start', String(startPage));
  if (endPage) qs.set('end', String(endPage));
  const res = await fetch(`${API_BASE}/books/${id}/text?${qs}`);
  return res.json();
}

export async function generateSummary(id: number, options?: { refresh?: boolean; ocr?: boolean }): Promise<{ summary: string; cached: boolean }> {
  let url = `${API_BASE}/books/${id}/summary`;
  const params = new URLSearchParams();
  if (options?.refresh) params.append('refresh', 'true');
  if (options?.ocr) params.append('ocr', 'true');
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  const res = await fetch(url, { method: 'POST' });
  return res.json();
}

// ── Collections ──

import type { Collection } from '../types';

export async function fetchCollections(): Promise<Collection[]> {
  const res = await fetch(`${API_BASE}/collections`);
  return res.json();
}

export async function fetchBookCollections(bookId: number): Promise<Collection[]> {
  const res = await fetch(`${API_BASE}/books/${bookId}/collections`);
  return res.json();
}

export async function createCollection(name: string, description: string, color: string): Promise<Collection> {
  const res = await fetch(`${API_BASE}/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, color }),
  });
  return res.json();
}

export async function updateCollection(id: number, name: string, description: string, color: string): Promise<void> {
  await fetch(`${API_BASE}/collections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, color }),
  });
}

export async function deleteCollection(id: number): Promise<void> {
  await fetch(`${API_BASE}/collections/${id}`, { method: 'DELETE' });
}

export async function addBookToCollection(bookId: number, collectionId: number): Promise<void> {
  await fetch(`${API_BASE}/collections/${collectionId}/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId }),
  });
}

export async function removeBookFromCollection(bookId: number, collectionId: number): Promise<void> {
  await fetch(`${API_BASE}/collections/${collectionId}/books/${bookId}`, { method: 'DELETE' });
}

// ── Enrichment APIs ──

export async function enrichBook(id: number): Promise<{
  found: boolean;
  source: string;
  title?: string;
  author?: string;
  description?: string;
  isbn?: string;
  coverPath?: string;
  coverUrl?: string;
}> {
  const res = await fetch(`${API_BASE}/books/${id}/enrich`, { method: 'POST' });
  return res.json();
}

export async function startBatchEnrich(): Promise<{ message: string; total: number }> {
  const res = await fetch(`${API_BASE}/enrich/batch`, { method: 'POST' });
  return res.json();
}

export interface EnrichStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  currentBook: string;
  errors: string[];
}

export async function fetchEnrichStatus(): Promise<EnrichStatus> {
  const res = await fetch(`${API_BASE}/enrich/status`);
  return res.json();
}

export async function cancelBatchEnrich(): Promise<void> {
  await fetch(`${API_BASE}/enrich/cancel`, { method: 'POST' });
}

export async function extractPdfCover(id: number): Promise<{ success: boolean; coverPath?: string }> {
  const res = await fetch(`${API_BASE}/books/${id}/extract-cover`, { method: 'POST' });
  return res.json();
}

export async function identifyTitle(id: number): Promise<{
  success: boolean;
  title?: string;
  author?: string;
  confidence?: string;
  message?: string;
}> {
  const res = await fetch(`${API_BASE}/books/${id}/identify-title`, { method: 'POST' });
  return res.json();
}

// ── Batch Cover Extraction APIs ──

export interface CoverBatchStatus {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  total: number;
  processed: number;
  extracted: number;
  failed: number;
  currentBook: string;
  errors: string[];
}

export async function startBatchCoverExtraction(): Promise<{ message: string; total: number }> {
  const res = await fetch(`${API_BASE}/covers/batch`, { method: 'POST' });
  return res.json();
}

export async function fetchCoverBatchStatus(): Promise<CoverBatchStatus> {
  const res = await fetch(`${API_BASE}/covers/batch/status`);
  return res.json();
}

export async function cancelBatchCoverExtraction(): Promise<void> {
  await fetch(`${API_BASE}/covers/batch/cancel`, { method: 'POST' });
}

// ── Bookmarks ──
export interface Bookmark {
  id: number;
  book_id: number;
  page: number;
  label: string;
  color: string;
  created_at: string;
}

export async function fetchBookmarks(bookId: number): Promise<Bookmark[]> {
  const res = await fetch(`${API_BASE}/books/${bookId}/bookmarks`);
  return res.json();
}

export async function addBookmark(bookId: number, page: number, label?: string, color?: string): Promise<Bookmark> {
  const res = await fetch(`${API_BASE}/books/${bookId}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, label, color }),
  });
  return res.json();
}

export async function removeBookmark(bookId: number, bookmarkId: number): Promise<void> {
  await fetch(`${API_BASE}/books/${bookId}/bookmarks/${bookmarkId}`, { method: 'DELETE' });
}

// ── Full-Text Search ──

export interface FullTextResult {
  bookId: number;
  title: string;
  author: string;
  page: number;
  snippet: string;
  format: string;
  coverSource: string;
}

export async function searchFullText(query: string, limit = 50): Promise<{ results: FullTextResult[]; query: string }> {
  const res = await fetch(`${API_BASE}/search/fulltext?q=${encodeURIComponent(query)}&limit=${limit}`);
  return res.json();
}

export async function searchInBook(bookId: number, query: string): Promise<{ results: { page: number; snippet: string }[]; query: string }> {
  const res = await fetch(`${API_BASE}/books/${bookId}/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

export interface IndexBatchStatus {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  errors: number;
  currentBook: string;
}

export async function startBatchIndexing(): Promise<void> {
  await fetch(`${API_BASE}/search/index/batch`, { method: 'POST' });
}

export async function fetchIndexStatus(): Promise<IndexBatchStatus> {
  const res = await fetch(`${API_BASE}/search/index/status`);
  return res.json();
}

export async function cancelBatchIndexing(): Promise<void> {
  await fetch(`${API_BASE}/search/index/cancel`, { method: 'POST' });
}

export async function fetchIndexStats(): Promise<{ total: number; indexed: number; empty: number; errors: number; pending: number }> {
  const res = await fetch(`${API_BASE}/search/index/stats`);
  return res.json();
}

// ── Extended Statistics (Fase 9) ──

export interface ExtendedStats {
  totalBooks: number;
  totalPages: number;
  completedBooks: number;
  totalPagesRead: number;
  formatStats: Array<{ name: string; value: number }>;
  categoryStats: Array<{ name: string; value: number }>;
}

export async function fetchExtendedStats(): Promise<ExtendedStats> {
  const res = await fetch(`${API_BASE}/stats/extended`);
  return res.json();
}

// ── Community & Forums ──

export interface Community {
  id: number;
  name: string;
  slug: string;
  description: string;
  rules: string;
  avatar_url: string;
  banner_url: string;
  type: string;
  book_id: number | null;
  created_by: string;
  creator_name: string;
  member_count: number;
  thread_count: number;
  created_at: string;
  user_role?: string | null;
}

export interface Thread {
  id: number;
  community_id: number;
  user_id: string;
  title: string;
  content: string;
  pinned: boolean;
  locked: boolean;
  has_spoilers: boolean;
  upvotes: number;
  reply_count: number;
  last_activity: string;
  created_at: string;
  author_name: string;
  author_avatar: string;
  community_name?: string;
  community_slug?: string;
}

export interface Reply {
  id: number;
  thread_id: number;
  parent_reply_id: number | null;
  user_id: string;
  content: string;
  upvotes: number;
  created_at: string;
  edited_at: string | null;
  author_name: string;
  author_avatar: string;
}

// Communities
export async function fetchCommunities(limit = 50): Promise<Community[]> {
  const res = await fetchWithRetry(`${API_BASE}/communities?limit=${limit}`);
  return res.json();
}

export async function fetchMyCommunities(): Promise<Community[]> {
  const res = await fetch(`${API_BASE}/communities/mine`, { credentials: 'include' });
  return res.json();
}

export async function fetchCommunity(slug: string): Promise<Community> {
  const res = await fetch(`${API_BASE}/communities/${slug}`, { credentials: 'include' });
  return res.json();
}

export async function createCommunityApi(name: string, description: string, rules = '', type = 'public'): Promise<Community> {
  const res = await fetch(`${API_BASE}/communities`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, rules, type }),
  });
  return res.json();
}

export async function joinCommunityApi(id: number): Promise<void> {
  await fetch(`${API_BASE}/communities/${id}/join`, { method: 'POST', credentials: 'include' });
}

export async function leaveCommunityApi(id: number): Promise<void> {
  await fetch(`${API_BASE}/communities/${id}/leave`, { method: 'POST', credentials: 'include' });
}

export async function fetchBookCommunity(bookId: number): Promise<Community> {
  const res = await fetch(`${API_BASE}/books/${bookId}/community`, { credentials: 'include' });
  return res.json();
}

// Threads
export async function fetchThreads(communityId: number, sort = 'recent'): Promise<{ threads: Thread[]; userVotes: Record<number, number> }> {
  const res = await fetch(`${API_BASE}/communities/${communityId}/threads?sort=${sort}`, { credentials: 'include' });
  return res.json();
}

export async function fetchThread(id: number): Promise<{ thread: Thread; replies: Reply[]; userVotes: Record<number, number> }> {
  const res = await fetch(`${API_BASE}/threads/${id}`, { credentials: 'include' });
  return res.json();
}

export async function createThreadApi(communityId: number, title: string, content: string, hasSpoilers = false): Promise<Thread> {
  const res = await fetch(`${API_BASE}/communities/${communityId}/threads`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, hasSpoilers }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Error creating thread');
  }
  return res.json();
}

export async function createReplyApi(threadId: number, content: string, parentReplyId?: number): Promise<Reply> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/replies`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, parentReplyId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Error creating reply');
  }
  return res.json();
}

export async function voteApi(targetType: 'thread' | 'reply', targetId: number, value: 1 | -1): Promise<{ action: string; newValue: number }> {
  const res = await fetch(`${API_BASE}/votes`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType, targetId, value }),
  });
  return res.json();
}

// Export API base so components can link directly to download endpoints
export { API_BASE };
