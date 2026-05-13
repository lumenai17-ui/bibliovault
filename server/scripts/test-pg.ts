/**
 * Test PostgreSQL connection to Supabase and initialize schema
 * Run: npx tsx scripts/test-pg.ts
 */
import 'dotenv/config';
import { testPgConnection, initPgSchema, getPgPool } from '../src/pgDatabase.js';

async function main() {
  console.log('🧪 Testing PostgreSQL connection to Supabase...');
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 40)}...`);

  const connected = await testPgConnection();
  if (!connected) {
    console.error('❌ Cannot connect to PostgreSQL. Check DATABASE_URL.');
    process.exit(1);
  }

  console.log('\n📋 Initializing schema...');
  await initPgSchema();

  // Quick verification
  const pool = getPgPool();
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
  console.log(`\n✅ Tables created (${tables.rows.length}):`);
  tables.rows.forEach((r: any) => console.log(`   📁 ${r.table_name}`));

  const catCount = await pool.query('SELECT COUNT(*) as c FROM categories');
  console.log(`\n📚 Categories seeded: ${catCount.rows[0].c}`);

  await pool.end();
  console.log('\n🎉 PostgreSQL setup complete!');
}

main().catch(console.error);
