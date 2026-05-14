const { Pool } = require('pg');
const p = new Pool({
  connectionString: 'postgresql://postgres.xzluufejwycnxpwafstt:%23%23pexW%2CX%2CX47NfA@aws-1-us-west-2.pooler.supabase.com:5432/postgres'
});

async function test() {
  try {
    // Simulate what stats/extended does
    const books = await p.query('SELECT * FROM books LIMIT 5');
    console.log('Books OK, rows:', books.rows.length);
    
    const cats = await p.query(`
      SELECT c.*, COUNT(b.id) as book_count
      FROM categories c
      LEFT JOIN books b ON b.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    console.log('Categories OK, rows:', cats.rows.length);
    
    // Test count query
    const allBooks = await p.query('SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id ORDER BY b.title ASC LIMIT 2000 OFFSET 0');
    console.log('AllBooks OK, rows:', allBooks.rows.length);
    console.log('Sample book keys:', Object.keys(allBooks.rows[0]));
    
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  p.end();
}
test();
