import { uploadFileToR2 } from './src/uploadStorage.js';
import { extname } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }});

async function run() {
  const result = await p.query(`
    SELECT id, cover_path FROM books 
    WHERE cover_path LIKE 'C:%'
  `);
  
  for (const row of result.rows) {
    console.log('Subiendo a R2:', row.id);
    const ext = extname(row.cover_path).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const r2Key = `covers/${row.id}${ext}`;
    
    const success = await uploadFileToR2(row.cover_path, r2Key, mime);
    if (success) {
      console.log('Exito:', r2Key);
      await p.query("UPDATE books SET r2_cover_key = $1, cover_path = NULL WHERE id = $2", [r2Key, row.id]);
    } else {
      console.log('Fallo.');
    }
  }
  p.end();
}
run();
