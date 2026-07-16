const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const BOOKS = require('./books');
const { pipeline } = require('@xenova/transformers');

const SOURCE_DB = path.join(__dirname, 'source-bible.db');

const VERSIONS = [
  { table: 't_kjv', code: 'kjv', name: 'King James Version' },
  { table: 't_asv', code: 'asv', name: 'American Standard Version' },
  { table: 't_bbe', code: 'bbe', name: 'Bible in Basic English' },
  { table: 't_web', code: 'web', name: 'World English Bible' },
  { table: 't_ylt', code: 'ylt', name: "Young's Literal Translation" },
];

if (!fs.existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB}. Download it first.`);
  process.exit(1);
}

const DB_PATH = path.join(__dirname, 'bible.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.exec(`ATTACH DATABASE '${SOURCE_DB.replace(/'/g, "''")}' AS src`);

db.exec(`
  CREATE TABLE versions (code TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE books (id INTEGER PRIMARY KEY, abbrev TEXT, name TEXT, book_order INTEGER);
  CREATE TABLE verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT,
    book_id INTEGER,
    book_name TEXT,
    chapter INTEGER,
    verse INTEGER,
    text TEXT,
    embedding BLOB
  );
  CREATE INDEX idx_verses_lookup ON verses(version, book_id, chapter, verse);
  CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id');
`);

const insVersion = db.prepare('INSERT INTO versions (code, name) VALUES (?, ?)');
const insBook = db.prepare('INSERT INTO books (id, abbrev, name, book_order) VALUES (?, ?, ?, ?)');
const insVerse = db.prepare(`INSERT INTO verses (version, book_id, book_name, chapter, verse, text, embedding)
                              VALUES (@version, @book_id, @book_name, @chapter, @verse, @text, @embedding)`);

BOOKS.forEach(([abbrev, name], idx) => {
  insBook.run(idx + 1, abbrev, name, idx + 1);
});

let embedder = null;
async function getEmbedder() {
  if (!embedder) embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return embedder;
}

async function generateEmbedding(text) {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Buffer.from(new Float32Array(output.data).buffer);
}

console.log("Importing Bible versions...");
let totalVerses = 0;

// Wrapped in an async function (rather than using top-level await) because
// mixing require() with top-level await in a plain .js file makes Node's
// CommonJS-vs-ESM detection ambiguous, and it may load the file as an ES
// module — which then makes every require() call above fail.
//
// better-sqlite3 transactions must also be fully synchronous, so we can't
// await inside db.transaction() (it throws "Transaction function cannot
// return a promise"). So for each version we generate every embedding first
// with plain async/await, then run the actual inserts as a fast synchronous
// transaction.
async function importAll() {
  for (const v of VERSIONS) {
    console.log(`Importing ${v.name}...`);
    insVersion.run(v.code, v.name);

    const rows = db.prepare(`SELECT b, c, v as verse, t as text FROM src.${v.table} ORDER BY id`).all();

    const prepared = [];
    for (const row of rows) {
      const bookIdx = row.b - 1;
      if (bookIdx < 0 || bookIdx >= BOOKS.length) continue;

      const bookName = BOOKS[bookIdx][1];
      const embedding = await generateEmbedding(row.text);

      prepared.push({
        version: v.code,
        book_id: row.b,
        book_name: bookName,
        chapter: row.c,
        verse: row.verse,
        text: row.text,
        embedding: embedding,
      });
    }

    const insertMany = db.transaction((allRows) => {
      for (const entry of allRows) {
        insVerse.run(entry);
        totalVerses++;
      }
    });
    insertMany(prepared);
  }

  console.log(`✅ Done! Imported ${totalVerses} verses with semantic embeddings.`);
  db.close();
}

importAll().catch((e) => {
  console.error('Import failed:', e);
  db.close();
  process.exit(1);
});
