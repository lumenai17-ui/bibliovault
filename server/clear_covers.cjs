const Database = require('better-sqlite3');
const db = new Database('C:/Users/Usuario/.gemini/antigravity/scratch/BiblioVault-AI/server/data/bibliovault.db');
db.prepare("UPDATE books SET cover_path = ''").run();
console.log('Cover paths cleared');
db.close();
