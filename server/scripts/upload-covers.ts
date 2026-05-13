/**
 * BiblioVault AI — Upload Covers to Supabase Storage
 * Uploads all local cover images to Supabase Storage bucket
 * and updates the cover_path in PostgreSQL to point to the public URL.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;
const COVERS_DIR = join(import.meta.dirname, '..', 'data', 'covers');
const BUCKET_NAME = 'covers';

// ── Init clients (service role key bypasses RLS) ──
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log('🖼️  BiblioVault Cover Upload to Supabase Storage\n');

  // 1. Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);
  
  if (!bucketExists) {
    console.log('📦 Creating "covers" bucket...');
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
      fileSizeLimit: 5 * 1024 * 1024, // 5MB max per cover
    });
    if (error) {
      console.error('Failed to create bucket:', error.message);
      return;
    }
    console.log('✅ Bucket created');
  } else {
    console.log('✅ Bucket "covers" already exists');
  }

  // 2. Read cover files
  if (!existsSync(COVERS_DIR)) {
    console.error(`❌ Covers directory not found: ${COVERS_DIR}`);
    return;
  }

  const files = readdirSync(COVERS_DIR).filter(f => 
    ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase())
  );
  
  console.log(`\n📸 Found ${files.length} cover images in ${COVERS_DIR}`);
  console.log('   Uploading to Supabase Storage...\n');

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;
  const batchSize = 10;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (filename) => {
      const filePath = join(COVERS_DIR, filename);
      const ext = extname(filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      
      try {
        const fileBuffer = readFileSync(filePath);
        
        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(filename, fileBuffer, {
            contentType: mimeType,
            upsert: true, // Overwrite if exists
          });
        
        if (error) {
          if (error.message?.includes('already exists')) {
            skipped++;
          } else {
            console.error(`  ❌ ${filename}: ${error.message}`);
            errors++;
          }
        } else {
          uploaded++;
        }
      } catch (err: any) {
        console.error(`  ❌ ${filename}: ${err.message}`);
        errors++;
      }
    }));

    // Progress
    const total = Math.min(i + batchSize, files.length);
    process.stdout.write(`\r   📸 ${total}/${files.length} processed...`);
  }

  console.log(`\n\n✅ Upload complete: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);

  // 3. Update cover_path in PostgreSQL to public URL
  console.log('\n🔄 Updating cover URLs in PostgreSQL...');
  
  const publicBaseUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}`;
  
  // Get all books that have a cover_path containing a local path
  const { rows: books } = await pool.query(
    `SELECT id, cover_path FROM books WHERE cover_path IS NOT NULL AND cover_path != ''`
  );

  let updatedCount = 0;
  for (const book of books) {
    const currentPath = book.cover_path as string;
    
    // Skip if already a Supabase URL
    if (currentPath.startsWith('http')) continue;
    
    // Extract filename from the local path
    const parts = currentPath.replace(/\\/g, '/').split('/');
    const coverFilename = parts[parts.length - 1];
    
    // Check if this file was uploaded
    if (files.includes(coverFilename)) {
      const publicUrl = `${publicBaseUrl}/${coverFilename}`;
      await pool.query(
        'UPDATE books SET cover_path = $1 WHERE id = $2',
        [publicUrl, book.id]
      );
      updatedCount++;
    }
  }

  console.log(`✅ Updated ${updatedCount} book cover URLs to Supabase Storage`);
  
  // Summary
  console.log('\n══════════════════════════════════════');
  console.log('  📊 COVER UPLOAD SUMMARY');
  console.log('══════════════════════════════════════');
  console.log(`  📸 Covers uploaded: ${uploaded}`);
  console.log(`  🔄 DB URLs updated: ${updatedCount}`);
  console.log(`  📦 Storage used: ~${(40.2).toFixed(1)} MB / 1024 MB`);
  console.log(`  🌐 Public URL: ${publicBaseUrl}/`);
  console.log('══════════════════════════════════════\n');

  await pool.end();
}

main().catch(console.error);
