import * as SQLite from 'expo-sqlite';

let db;

export async function initDatabase() {
  db = await SQLite.openDatabaseAsync('epubreader.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      file_path TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      added_at INTEGER,
      last_opened_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS progress (
      book_id INTEGER PRIMARY KEY,
      cfi TEXT,
      percentage REAL DEFAULT 0,
      updated_at INTEGER,
      FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      cfi TEXT NOT NULL,
      label TEXT,
      created_at INTEGER,
      FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
    );
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ---------- Books ----------

export async function addBook({ title, author, filePath, coverPath }) {
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO books (title, author, file_path, cover_path, added_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, author || 'Unknown', filePath, coverPath || null, now, now]
  );
  return result.lastInsertRowId;
}

export async function getAllBooks() {
  return await db.getAllAsync(
    `SELECT b.*, p.percentage
     FROM books b
     LEFT JOIN progress p ON p.book_id = b.id
     ORDER BY b.last_opened_at DESC`
  );
}

export async function getBook(bookId) {
  return await db.getFirstAsync(`SELECT * FROM books WHERE id = ?`, [bookId]);
}

export async function touchBook(bookId) {
  await db.runAsync(`UPDATE books SET last_opened_at = ? WHERE id = ?`, [Date.now(), bookId]);
}

export async function deleteBook(bookId) {
  await db.runAsync(`DELETE FROM books WHERE id = ?`, [bookId]);
}

// ---------- Progress ----------

export async function saveProgress(bookId, cfi, percentage) {
  await db.runAsync(
    `INSERT INTO progress (book_id, cfi, percentage, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET cfi = excluded.cfi,
       percentage = excluded.percentage, updated_at = excluded.updated_at`,
    [bookId, cfi, percentage, Date.now()]
  );
}

export async function getProgress(bookId) {
  return await db.getFirstAsync(`SELECT * FROM progress WHERE book_id = ?`, [bookId]);
}

// ---------- Bookmarks ----------

export async function addBookmark(bookId, cfi, label) {
  const result = await db.runAsync(
    `INSERT INTO bookmarks (book_id, cfi, label, created_at) VALUES (?, ?, ?, ?)`,
    [bookId, cfi, label || '', Date.now()]
  );
  return result.lastInsertRowId;
}

export async function getBookmarks(bookId) {
  return await db.getAllAsync(
    `SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC`,
    [bookId]
  );
}

export async function deleteBookmark(id) {
  await db.runAsync(`DELETE FROM bookmarks WHERE id = ?`, [id]);
}
