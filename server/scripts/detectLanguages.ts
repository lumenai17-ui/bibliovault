import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('❌ Missing GROQ_API_KEY in .env');
  process.exit(1);
}

async function detectLanguagesForBatch(books: { id: number; title: string }[]) {
  const prompt = `You are an expert language detector. I will provide a JSON array of book titles. 
You must return a JSON array containing the language code ('es', 'en', 'pt', 'fr', 'it', 'de', etc.) for each book.
Reply ONLY with the raw JSON array. No markdown, no explanation.
Example input: [{"id": 1, "title": "Cien años de soledad"}, {"id": 2, "title": "The Great Gatsby"}]
Example output: [{"id": 1, "lang": "es"}, {"id": 2, "lang": "en"}]

Input: ${JSON.stringify(books)}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.error('Groq API error:', await res.text());
      return [];
    }

    const data = await res.json();
    let text = data.choices[0].message.content.trim();
    if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(text);
    return parsed as { id: number; lang: string }[];
  } catch (err) {
    console.error('Failed to parse AI response:', err);
    return [];
  }
}

async function main() {
  const { getPgPool } = await import('../src/pgDatabase.js');
  const pool = getPgPool();
  
  console.log('📚 Fetching books without language...');
  const result = await pool.query(`SELECT id, title FROM books WHERE language = '' OR language IS NULL`);
  const books = result.rows;
  
  console.log(`Found ${books.length} books to process.`);

  const BATCH_SIZE = 50;
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);
    console.log(`\n⏳ Processing batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(books.length / BATCH_SIZE)}...`);
    
    const updates = await detectLanguagesForBatch(batch);
    
    for (const update of updates) {
      if (update.lang) {
        await pool.query(`UPDATE books SET language = $1 WHERE id = $2`, [update.lang.toLowerCase(), update.id]);
      }
    }
    
    console.log(`✅ Updated ${updates.length} books.`);
    // Small delay to prevent rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n🎉 Finished updating book languages!');
  process.exit(0);
}

main().catch(console.error);
