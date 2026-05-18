import { enrichBook } from './src/metadataEnricher.js';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }});

async function run() {
  const result = await p.query(`
    SELECT b.id, b.title, b.file_name, b.file_path, b.author 
    FROM books b 
    JOIN categories c ON b.category_id = c.id 
    WHERE c.name ILIKE '%filosof%' 
    AND (b.r2_cover_key IS NULL OR b.cover_source = 'svg')
  `);
  
  for (const row of result.rows) {
    console.log('Enriqueciendo:', row.title);
    const r = await enrichBook(row.id, row.file_name, row.author || '', row.file_path);
    if (r.coverPath) {
      console.log('Cover encontrado:', r.coverPath);
      await p.query("UPDATE books SET cover_path = $1, cover_source = 'api' WHERE id = $2", [r.coverPath, row.id]);
    } else {
      console.log('No se encontro cover.');
      await p.query("UPDATE books SET cover_source = NULL WHERE id = $1", [row.id]);
    }
  }
  p.end();
}
run();
