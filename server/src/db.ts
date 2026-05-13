/**
 * BiblioVault AI — Unified Database Adapter
 * 
 * Auto-detects DATABASE_URL:
 *   - If set → uses PostgreSQL (Supabase cloud)
 *   - If not → uses SQLite (local development)
 * 
 * All exported functions are async for compatibility.
 */

import type { BookRow, UserRow, CollectionRow } from './database.js';

const USE_PG = !!process.env.DATABASE_URL;

// ── Dynamic imports based on backend ──

let _sqlite: typeof import('./database.js') | null = null;
let _pg: typeof import('./pgDatabase.js') | null = null;

async function getSqlite() {
  if (!_sqlite) _sqlite = await import('./database.js');
  return _sqlite;
}

async function getPg() {
  if (!_pg) _pg = await import('./pgDatabase.js');
  return _pg;
}

/** Initialize database (must be called at startup) */
export async function initDatabase() {
  if (USE_PG) {
    const pg = await getPg();
    const ok = await pg.testPgConnection();
    if (!ok) throw new Error('PostgreSQL connection failed');
    await pg.initPgSchema();
    console.log('🐘 Using PostgreSQL (Supabase)');
  } else {
    const sqlite = await getSqlite();
    sqlite.getDb();
    console.log('📦 Using SQLite (local)');
  }
}

/** Get raw DB handle (for direct queries in routes) */
export function getDb() {
  if (USE_PG) {
    // Return a proxy-like object — routes that need raw DB should use specific functions
    throw new Error('Use specific db functions instead of getDb() with PostgreSQL');
  }
  // Sync import for SQLite (already loaded at init)
  return _sqlite!.getDb();
}

/** Check if we're using PostgreSQL */
export function isPostgres(): boolean {
  return USE_PG;
}

// ══════════════════════════════════════
//  Book Operations
// ══════════════════════════════════════

export async function getAllBooks(limit?: number, offset?: number, filters?: {
  format?: string; category_id?: number; favorite?: boolean; search?: string; collection_id?: number;
}) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetAllBooks(limit, offset, filters);
  }
  const s = await getSqlite();
  return s.getAllBooks(limit, offset, filters);
}

export async function getBookById(id: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetBookById(id);
  }
  const s = await getSqlite();
  return s.getBookById(id);
}

export async function updateBook(id: number, updates: Partial<BookRow>) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpdateBook(id, updates);
  }
  const s = await getSqlite();
  return s.updateBook(id, updates);
}

export async function insertBook(book: Omit<BookRow, 'id' | 'date_added'>) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgInsertBook(book);
  }
  const s = await getSqlite();
  return s.insertBook(book);
}

export async function getCategories() {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetCategories();
  }
  const s = await getSqlite();
  return s.getCategories();
}

export async function getStats() {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetStats();
  }
  const s = await getSqlite();
  return s.getStats();
}

export async function getCategoryByName(name: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetCategoryByName(name);
  }
  const s = await getSqlite();
  return s.getCategoryByName(name);
}

export async function bookExistsByPath(filePath: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgBookExistsByPath(filePath);
  }
  const s = await getSqlite();
  return s.bookExistsByPath(filePath);
}

export async function getBooksWithoutCovers(limit?: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetBooksWithoutCovers(limit);
  }
  const s = await getSqlite();
  return s.getBooksWithoutCovers(limit);
}

export async function getUnenrichedBooks(limit?: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUnenrichedBooks(limit);
  }
  const s = await getSqlite();
  return s.getUnenrichedBooks(limit);
}

// ══════════════════════════════════════
//  Collection Operations
// ══════════════════════════════════════

export async function getCollections() {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetCollections();
  }
  const s = await getSqlite();
  return s.getCollections();
}

export async function createCollection(name: string, description?: string, color?: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgCreateCollection(name, description, color);
  }
  const s = await getSqlite();
  return s.createCollection(name, description, color);
}

export async function updateCollection(id: number, name: string, description: string, color: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpdateCollection(id, name, description, color);
  }
  const s = await getSqlite();
  return s.updateCollection(id, name, description, color);
}

export async function deleteCollection(id: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgDeleteCollection(id);
  }
  const s = await getSqlite();
  return s.deleteCollection(id);
}

export async function addBookToCollection(bookId: number, collectionId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgAddBookToCollection(bookId, collectionId);
  }
  const s = await getSqlite();
  return s.addBookToCollection(bookId, collectionId);
}

export async function removeBookFromCollection(bookId: number, collectionId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgRemoveBookFromCollection(bookId, collectionId);
  }
  const s = await getSqlite();
  return s.removeBookFromCollection(bookId, collectionId);
}

export async function getBookCollections(bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetBookCollections(bookId);
  }
  const s = await getSqlite();
  return s.getBookCollections(bookId);
}

// ══════════════════════════════════════
//  User Operations
// ══════════════════════════════════════

export async function getUserById(id: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserById(id);
  }
  const s = await getSqlite();
  return s.getUserById(id);
}

export async function getUserByEmail(email: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserByEmail(email);
  }
  const s = await getSqlite();
  return s.getUserByEmail(email);
}

export async function createUser(id: string, email: string, passwordHash: string, displayName: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgCreateUser(id, email, passwordHash, displayName);
  }
  const s = await getSqlite();
  return s.createUser(id, email, passwordHash, displayName);
}

export async function updateUser(id: string, updates: Record<string, string>) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpdateUser(id, updates);
  }
  const s = await getSqlite();
  return s.updateUser(id, updates as any);
}

export async function updateUserPassword(id: string, passwordHash: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpdateUserPassword(id, passwordHash);
  }
  const s = await getSqlite();
  return s.updateUserPassword(id, passwordHash);
}

export async function updateLastLogin(id: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpdateLastLogin(id);
  }
  const s = await getSqlite();
  return s.updateLastLogin(id);
}

// ══════════════════════════════════════
//  User Favorites
// ══════════════════════════════════════

export async function getUserFavorites(userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserFavorites(userId);
  }
  const s = await getSqlite();
  return s.getUserFavorites(userId);
}

export async function isUserFavorite(userId: string, bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgIsUserFavorite(userId, bookId);
  }
  const s = await getSqlite();
  return s.isUserFavorite(userId, bookId);
}

export async function addUserFavorite(userId: string, bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgAddUserFavorite(userId, bookId);
  }
  const s = await getSqlite();
  return s.addUserFavorite(userId, bookId);
}

export async function removeUserFavorite(userId: string, bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgRemoveUserFavorite(userId, bookId);
  }
  const s = await getSqlite();
  return s.removeUserFavorite(userId, bookId);
}

export async function countUserFavorites(userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgCountUserFavorites(userId);
  }
  const s = await getSqlite();
  return s.countUserFavorites(userId);
}

// ══════════════════════════════════════
//  User Reading Progress
// ══════════════════════════════════════

export async function getUserReadingProgress(userId: string, bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserReadingProgress(userId, bookId);
  }
  const s = await getSqlite();
  return s.getUserReadingProgress(userId, bookId);
}

export async function setUserReadingProgress(userId: string, bookId: number, progress: number, currentPage?: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgSetUserReadingProgress(userId, bookId, progress, currentPage);
  }
  const s = await getSqlite();
  return s.setUserReadingProgress(userId, bookId, progress, currentPage);
}

export async function getUserBooksReading(userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserBooksReading(userId);
  }
  const s = await getSqlite();
  return s.getUserBooksReading(userId);
}

// ══════════════════════════════════════
//  Affiliates
// ══════════════════════════════════════

export async function getAffiliateLinks(bookId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetAffiliateLinks(bookId);
  }
  const s = await getSqlite();
  return s.getAffiliateLinks(bookId);
}

export async function upsertAffiliateLink(bookId: number, platform: string, url: string, price?: number, currency?: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgUpsertAffiliateLink(bookId, platform, url, price, currency);
  }
  const s = await getSqlite();
  return s.upsertAffiliateLink(bookId, platform, url, price, currency);
}

export async function trackAffiliateClick(userId: string | null, linkId: number) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgTrackAffiliateClick(userId, linkId);
  }
  const s = await getSqlite();
  return s.trackAffiliateClick(userId, linkId);
}

// ══════════════════════════════════════
//  User Uploads
// ══════════════════════════════════════

export async function getUserUploads(userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgGetUserUploads(userId);
  }
  const s = await getSqlite();
  return s.getUserUploads(userId);
}

export async function countUserUploads(userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgCountUserUploads(userId);
  }
  const s = await getSqlite();
  return s.countUserUploads(userId);
}

export async function insertUserUpload(userId: string, bookId: number | null, originalFilename: string, storagePath: string, fileSize: number, sharedGlobally?: boolean) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgInsertUserUpload(userId, bookId, originalFilename, storagePath, fileSize, sharedGlobally);
  }
  const s = await getSqlite();
  return s.insertUserUpload(userId, bookId as any, originalFilename, storagePath, fileSize, sharedGlobally);
}

export async function deleteUserUpload(id: number, userId: string) {
  if (USE_PG) {
    const pg = await getPg();
    return pg.pgDeleteUserUpload(id, userId);
  }
  const s = await getSqlite();
  return s.deleteUserUpload(id, userId);
}

// Re-export types
export type { BookRow, UserRow, CollectionRow };
