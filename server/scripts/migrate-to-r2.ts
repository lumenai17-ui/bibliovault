/**
 * BiblioVault — Migrate books & covers to Cloudflare R2
 * 
 * Reads all books from PostgreSQL, uploads their files and covers
 * to R2, and updates the database with R2 URLs.
 * 
 * Usage: npx tsx scripts/migrate-to-r2.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import pg from 'pg';

// ── Config ──
const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET || 'bibliovault-books';
const DATABASE_URL = process.env.DATABASE_URL!;
const LIBRARY_PATH = process.env.LIBRARY_PATH || 'C:\\Users\\Usuario\\OneDrive\\Documentos\\Lectura';

// ── S3 Client (R2 is S3-compatible) ──
const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ── MIME types ──
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.djvu': 'image/vnd.djvu',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// ── Helpers ──
async function fileExistsInR2(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToR2(key: string, filePath: string): Promise<boolean> {
  try {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const body = readFileSync(filePath);

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));

    return true;
  } catch (err: any) {
    console.error(`  ❌ Upload failed for ${key}: ${err.message}`);
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('📦 BiblioVault — Migración a Cloudflare R2');
  console.log('═══════════════════════════════════════════════════\n');

  // Verify config
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('❌ Missing R2 credentials in .env');
    process.exit(1);
  }

  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL in .env');
    process.exit(1);
  }

  // Connect to PG
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  console.log('🐘 Connecting to PostgreSQL...');
  await pool.query('SELECT 1');
  console.log('✅ Connected\n');

  // Check if r2_file_key column exists, add if not
  try {
    await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS r2_file_key TEXT`);
    await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS r2_cover_key TEXT`);
    console.log('✅ DB columns ready (r2_file_key, r2_cover_key)\n');
  } catch (err: any) {
    console.log('⚠️ Column check:', err.message);
  }

  // Get all books
  const { rows: books } = await pool.query(
    `SELECT id, title, file_path, cover_path, format, r2_file_key, r2_cover_key FROM books ORDER BY id`
  );

  console.log(`📚 Found ${books.length} books to process\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  let coverUploaded = 0;
  let coverFailed = 0;

  // ── Upload book files ──
  console.log('── Phase 1: Uploading book files ──\n');

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const progress = `[${i + 1}/${books.length}]`;

    // Skip if already uploaded
    if (book.r2_file_key) {
      skipped++;
      continue;
    }

    const filePath = book.file_path;
    if (!filePath || !existsSync(filePath)) {
      console.log(`${progress} ⚠️ Skip (file not found): ${book.title?.slice(0, 50)}`);
      failed++;
      continue;
    }

    const stat = statSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const key = `books/${book.id}${ext}`;

    // Check if already in R2
    const exists = await fileExistsInR2(key);
    if (exists) {
      // Update DB and skip
      await pool.query(`UPDATE books SET r2_file_key = $1 WHERE id = $2`, [key, book.id]);
      skipped++;
      continue;
    }

    process.stdout.write(`${progress} ⬆️  ${formatBytes(stat.size)} ${book.title?.slice(0, 45)}...`);

    const ok = await uploadToR2(key, filePath);
    if (ok) {
      await pool.query(`UPDATE books SET r2_file_key = $1 WHERE id = $2`, [key, book.id]);
      uploaded++;
      totalBytes += stat.size;
      process.stdout.write(` ✅\n`);
    } else {
      failed++;
      process.stdout.write(` ❌\n`);
    }

    // Progress summary every 50 books
    if ((i + 1) % 50 === 0) {
      console.log(`\n  📊 Progress: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed (${formatBytes(totalBytes)} total)\n`);
    }
  }

  console.log(`\n── Phase 1 Complete ──`);
  console.log(`  ✅ Uploaded: ${uploaded} (${formatBytes(totalBytes)})`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Failed: ${failed}\n`);

  // ── Upload covers ──
  console.log('── Phase 2: Uploading covers ──\n');

  for (let i = 0; i < books.length; i++) {
    const book = books[i];

    // Skip if already uploaded
    if (book.r2_cover_key) continue;

    const coverPath = book.cover_path;
    if (!coverPath || !existsSync(coverPath)) continue;

    const ext = extname(coverPath).toLowerCase();
    const key = `covers/${book.id}${ext}`;

    const exists = await fileExistsInR2(key);
    if (exists) {
      await pool.query(`UPDATE books SET r2_cover_key = $1 WHERE id = $2`, [key, book.id]);
      continue;
    }

    const ok = await uploadToR2(key, coverPath);
    if (ok) {
      await pool.query(`UPDATE books SET r2_cover_key = $1 WHERE id = $2`, [key, book.id]);
      coverUploaded++;
    } else {
      coverFailed++;
    }
  }

  console.log(`  ✅ Covers uploaded: ${coverUploaded}`);
  console.log(`  ❌ Covers failed: ${coverFailed}\n`);

  // ── Summary ──
  console.log('═══════════════════════════════════════════════════');
  console.log('📦 Migration Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Books uploaded:  ${uploaded}/${books.length}`);
  console.log(`  Books skipped:   ${skipped}`);
  console.log(`  Books failed:    ${failed}`);
  console.log(`  Covers uploaded: ${coverUploaded}`);
  console.log(`  Total data:      ${formatBytes(totalBytes)}`);
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
  console.log('✅ Done! Books are now on Cloudflare R2.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
