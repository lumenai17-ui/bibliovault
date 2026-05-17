/* ============================================
   BiblioVault AI — TypeScript Interfaces
   ============================================ */

export type BookFormat = 'epub' | 'pdf' | 'doc' | 'docx' | 'image';
export type ContentType = 'text' | 'scan' | 'image';
export type OcrStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed';
export type ViewMode = 'grid' | 'list';

export interface Book {
  id: number;
  title: string;
  author: string;
  description: string;
  isbn: string;
  language: string;
  pages: number;
  format: BookFormat;
  contentType: ContentType;
  filePath: string;
  fileName: string;
  fileSize: number;
  coverPath: string;
  category: string;
  subcategory: string;
  tags: string[];
  dateAdded: string;
  lastRead: string | null;
  readingProgress: number;
  favorite: boolean;
  ocrStatus: OcrStatus;
  aiSummary: string | null;
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
  aiSuggested: boolean;
  children?: Category[];
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  color: string;
  book_count?: number;
}

export interface ReadingSession {
  id: number;
  bookId: number;
  startedAt: string;
  endedAt: string | null;
  position: string;
  notes: string;
}

export interface AiConversation {
  id: number;
  bookId: number;
  createdAt: string;
  messages: AiMessage[];
}

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface LibraryStats {
  totalBooks: number;
  byFormat: Record<BookFormat, number>;
  byCategory: Record<string, number>;
  favorites: number;
  currentlyReading: number;
  recentlyAdded: number;
}

export interface ScanProgress {
  status: 'idle' | 'scanning' | 'extracting' | 'done' | 'error';
  total: number;
  processed: number;
  currentFile: string;
  errors: string[];
}

export interface SearchFilters {
  query: string;
  format: BookFormat | 'all';
  category: string;
  favorite: boolean | null;
  sortBy: 'title' | 'author' | 'dateAdded' | 'lastRead' | 'progress';
  sortOrder: 'asc' | 'desc';
}

export interface TtsSettings {
  provider: 'native' | 'external';
  voice: string;
  rate: number;
  pitch: number;
  externalApiUrl: string;
  externalApiKey: string;
}

export interface AppSettings {
  libraryPath: string;
  hermesUrl: string;
  tts: TtsSettings;
  theme: 'dark' | 'light' | 'sepia';
  language: 'es' | 'en';
}
