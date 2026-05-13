/**
 * BiblioVault AI — Export SQLite book metadata to Supabase PostgreSQL
 * 
 * This script reads all books from the local SQLite database
 * and inserts them into the Supabase PostgreSQL database.
 * 
 * Run: npx tsx scripts/export-to-pg.ts
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPgPool, initPgSchema } from '../src/pgDatabase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'bibliovault.db');

async function main() {
  console.log('📤 BiblioVault — Exporting SQLite → PostgreSQL (Supabase)');
  console.log(`   Source: ${DB_PATH}`);
  
  // Open SQLite
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  
  // Connect to PostgreSQL
  const pg = getPgPool();
  await initPgSchema();
  
  // ── Export Categories ──
  console.log('\n📁 Exporting categories...');
  const categories = sqlite.prepare('SELECT * FROM categories ORDER BY id').all() as any[];
  let catCount = 0;
  for (const cat of categories) {
    try {
      await pg.query(
        `INSERT INTO categories (id, name, parent_id, ai_suggested, created_at) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET parent_id = $3`,
        [cat.id, cat.name, cat.parent_id, cat.ai_suggested || 0, cat.created_at || new Date().toISOString()],
      );
      catCount++;
    } catch (err: any) {
      if (!err.message.includes('duplicate')) {
        console.error(`   ⚠️ Category "${cat.name}": ${err.message}`);
      }
    }
  }
  // Reset sequence to max id
  await pg.query(`SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories))`);
  console.log(`   ✅ ${catCount} categories exported`);
  
  // ── Export Books ──
  console.log('\n📚 Exporting books...');
  const books = sqlite.prepare(`
    SELECT b.*, c.name as category_name 
    FROM books b 
    LEFT JOIN categories c ON b.category_id = c.id 
    ORDER BY b.id
  `).all() as any[];
  
  let bookCount = 0;
  let bookErrors = 0;
  const BATCH_SIZE = 50;
  
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);
    
    for (const book of batch) {
      try {
        await pg.query(`
          INSERT INTO books (
            id, title, author, description, isbn, language, pages,
            format, content_type, file_path, file_name, file_size, cover_path,
            category_id, subcategory, tags, date_added, last_read,
            reading_progress, favorite, ocr_status, ai_summary, folder_category,
            enriched, original_title, cover_source, enrichment_source
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
          ) ON CONFLICT (file_path) DO UPDATE SET
            title = $2, author = $3, description = $4, isbn = $5,
            language = $6, pages = $7, cover_path = $13,
            category_id = $14, tags = $16, ai_summary = $22,
            enriched = $24, cover_source = $26
        `, [
          book.id,
          book.title || 'Sin título',
          book.author || '',
          book.description || '',
          book.isbn || '',
          book.language || '',
          book.pages || 0,
          book.format || 'pdf',
          book.content_type || 'text',
          book.file_path || '',
          book.file_name || '',
          book.file_size || 0,
          book.cover_path || '',
          book.category_id,
          book.subcategory || '',
          book.tags || '[]',
          book.date_added || new Date().toISOString(),
          book.last_read || null,
          book.reading_progress || 0,
          book.favorite || 0,
          book.ocr_status || 'none',
          book.ai_summary || null,
          book.folder_category || '',
          book.enriched || 0,
          book.original_title || '',
          book.cover_source || 'svg',
          book.enrichment_source || '',
        ]);
        bookCount++;
      } catch (err: any) {
        bookErrors++;
        if (bookErrors <= 5) {
          console.error(`   ⚠️ Book "${book.title}": ${err.message.substring(0, 100)}`);
        }
      }
    }
    
    process.stdout.write(`\r   📚 ${Math.min(i + BATCH_SIZE, books.length)}/${books.length} processed...`);
  }
  
  // Reset sequence
  await pg.query(`SELECT setval('books_id_seq', (SELECT MAX(id) FROM books))`);
  console.log(`\n   ✅ ${bookCount} books exported (${bookErrors} errors)`);
  
  // ── Export Collections ──
  console.log('\n📂 Exporting collections...');
  const collections = sqlite.prepare('SELECT * FROM collections ORDER BY id').all() as any[];
  for (const col of collections) {
    try {
      await pg.query(
        `INSERT INTO collections (id, name, description, color, user_id, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [col.id, col.name, col.description || '', col.color || '#667eea', col.user_id || null, col.created_at || new Date().toISOString()],
      );
    } catch {}
  }
  if (collections.length > 0) {
    await pg.query(`SELECT setval('collections_id_seq', (SELECT COALESCE(MAX(id), 1) FROM collections))`);
  }
  console.log(`   ✅ ${collections.length} collections exported`);
  
  // ── Export Book-Collection relationships ──
  const bookCols = sqlite.prepare('SELECT * FROM book_collections').all() as any[];
  for (const bc of bookCols) {
    try {
      await pg.query(
        'INSERT INTO book_collections (book_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [bc.book_id, bc.collection_id],
      );
    } catch {}
  }
  console.log(`   ✅ ${bookCols.length} book-collection links exported`);
  
  // ── Export Users ──
  console.log('\n👤 Exporting users...');
  const users = sqlite.prepare('SELECT * FROM users ORDER BY created_at').all() as any[];
  for (const user of users) {
    try {
      await pg.query(
        `INSERT INTO users (id, email, password_hash, display_name, plan, avatar_url, created_at, last_login)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email) DO UPDATE SET display_name = $4, plan = $5, last_login = $8`,
        [user.id, user.email, user.password_hash, user.display_name || '', user.plan || 'free', user.avatar_url || '', user.created_at, user.last_login],
      );
    } catch (err: any) {
      console.error(`   ⚠️ User "${user.email}": ${err.message.substring(0, 80)}`);
    }
  }
  console.log(`   ✅ ${users.length} users exported`);

  // ── Export Bookmarks ──
  const bookmarks = sqlite.prepare('SELECT * FROM bookmarks ORDER BY id').all() as any[];
  if (bookmarks.length > 0) {
    for (const bm of bookmarks) {
      try {
        await pg.query(
          `INSERT INTO bookmarks (id, book_id, page, label, color, user_id, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [bm.id, bm.book_id, bm.page, bm.label || '', bm.color || '#667eea', bm.user_id || null, bm.created_at],
        );
      } catch {}
    }
    await pg.query(`SELECT setval('bookmarks_id_seq', (SELECT COALESCE(MAX(id), 1) FROM bookmarks))`);
    console.log(`   ✅ ${bookmarks.length} bookmarks exported`);
  }

  // ── Summary ──
  const pgBookCount = await pg.query('SELECT COUNT(*) as c FROM books');
  const pgCatCount = await pg.query('SELECT COUNT(*) as c FROM categories');
  const pgUserCount = await pg.query('SELECT COUNT(*) as c FROM users');
  
  console.log('\n══════════════════════════════════════');
  console.log('  📊 EXPORT SUMMARY');
  console.log('══════════════════════════════════════');
  console.log(`  📚 Books in PostgreSQL: ${pgBookCount.rows[0].c}`);
  console.log(`  📁 Categories: ${pgCatCount.rows[0].c}`);
  console.log(`  👤 Users: ${pgUserCount.rows[0].c}`);
  console.log('══════════════════════════════════════');
  
  sqlite.close();
  await pg.end();
  console.log('\n🎉 Export complete!');
}

main().catch(console.error);
