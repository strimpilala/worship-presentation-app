const path = require('path');
const Database = require('better-sqlite3');
const BOOKS = require('./books');
const axios = require('axios');

let db = null;
function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, 'bible.db'), { readonly: true, fileMustExist: true });
  }
  return db;
}

// Alias lookup for reference parsing
const ALIAS_TO_BOOK = [];
BOOKS.forEach(([abbrev, name, ...aliases], idx) => {
  const bookId = idx + 1;
  [name, abbrev, ...aliases].forEach((alias) => {
    ALIAS_TO_BOOK.push({ alias: alias.toLowerCase(), bookId, name });
  });
});
ALIAS_TO_BOOK.sort((a, b) => b.alias.length - a.alias.length);

function parseReference(raw) {
  if (!raw) return null;
  let text = raw.toLowerCase().trim()
    .replace(/chapter/g, ' ')
    .replace(/verses?/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = ALIAS_TO_BOOK.find((b) => text.startsWith(b.alias + ' ') || text === b.alias);
  if (!match) return null;

  const rest = text.slice(match.alias.length).trim();
  if (!rest) return { bookId: match.bookId, bookName: match.name, chapter: 1, verseStart: null, verseEnd: null };

  const refMatch = rest.match(/^(\d+)[\s:]*(\d+)?(?:\s*[-to]+\s*(\d+))?/);
  if (!refMatch) return { bookId: match.bookId, bookName: match.name, chapter: 1, verseStart: null, verseEnd: null };

  const chapter = parseInt(refMatch[1], 10);
  const verseStart = refMatch[2] ? parseInt(refMatch[2], 10) : null;
  const verseEnd = refMatch[3] ? parseInt(refMatch[3], 10) : verseStart;

  return { bookId: match.bookId, bookName: match.name, chapter, verseStart, verseEnd };
}

function getByReference(ref, version) {
  const database = getDb();
  if (ref.verseStart) {
    return database.prepare(`
      SELECT book_name, chapter, verse, text FROM verses
      WHERE version = ? AND book_id = ? AND chapter = ? AND verse BETWEEN ? AND ?
      ORDER BY verse
    `).all(version, ref.bookId, ref.chapter, ref.verseStart, ref.verseEnd);
  }
  return database.prepare(`
    SELECT book_name, chapter, verse, text FROM verses
    WHERE version = ? AND book_id = ? AND chapter = ?
    ORDER BY verse
  `).all(version, ref.bookId, ref.chapter);
}

function getByReferenceAllVersions(ref) {
  const database = getDb();
  const versions = database.prepare('SELECT code, name FROM versions').all();
  return versions.map((v) => ({
    version: v.code,
    versionName: v.name,
    verses: getByReference(ref, v.code),
  }));
}

function phraseSearch(query, version, limit = 15) {
  const database = getDb();
  const cleaned = query.trim().replace(/[^\w\s']/g, ' ').trim();
  if (!cleaned) return [];

  const words = cleaned.split(/\s+/).filter(Boolean);
  const phraseQuery = `"${cleaned.replace(/"/g, '')}"`;
  const andQuery = words.map((w) => `"${w}"`).join(' AND ');
  const orQuery = words.map((w) => `"${w}"`).join(' OR ');

  const runQuery = (ftsQuery) => {
    try {
      return database.prepare(`
        SELECT v.book_name, v.chapter, v.verse, v.text, v.version
        FROM verses_fts f
        JOIN verses v ON v.id = f.rowid
        WHERE verses_fts MATCH ? AND v.version = ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, version, limit);
    } catch (e) {
      return [];
    }
  };

  let results = runQuery(phraseQuery);
  if (results.length < 5) results = runQuery(andQuery);
  if (results.length < 4) results = runQuery(orQuery);

  return results;
}

// Web search fallback for vague references
async function webSearch(query, version = 'kjv', limit = 6) {
  try {
    const res = await axios.get('https://bible-api.com/', {
      params: { q: query }
    });
    if (res.data && res.data.verses) {
      return res.data.verses.map(v => ({
        book_name: v.book_name || v.book,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text,
        version: version.toUpperCase()
      }));
    }
    return [];
  } catch (e) {
    console.warn("Web search unavailable:", e.message);
    return [];
  }
}

// Main search function (local + web fallback)
async function search(rawInput, version) {
  const ref = parseReference(rawInput);
  if (ref) {
    return { type: 'reference', reference: ref, results: getByReference(ref, version) };
  }

  let results = phraseSearch(rawInput, version);

  // For vague queries with few local results → use web search
  if (results.length < 5) {
    const webResults = await webSearch(rawInput, version);
    const seen = new Set(results.map(r => `${r.book_name}-${r.chapter}-${r.verse}`));
    webResults.forEach(item => {
      const key = `${item.book_name}-${item.chapter}-${item.verse}`;
      if (!seen.has(key)) {
        results.push(item);
        seen.add(key);
      }
    });
  }

  return { type: 'phrase', results };
}

function listVersions() {
  return getDb().prepare('SELECT code, name FROM versions').all();
}

module.exports = { 
  parseReference, 
  getByReference, 
  getByReferenceAllVersions, 
  phraseSearch, 
  listVersions, 
  search 
};