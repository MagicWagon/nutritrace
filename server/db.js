import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || './nutritrace.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Core tables ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    nickname      TEXT,
    birthday      TEXT,
    gender        TEXT,
    avatar_url    TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    brand      TEXT,
    nutrition  TEXT DEFAULT '{}',
    portion    REAL DEFAULT 100,
    unit       TEXT DEFAULT 'g',
    img_url    TEXT,
    notes      TEXT,
    category   TEXT,
    barcode    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    nutrition  TEXT DEFAULT '{}',
    items      TEXT DEFAULT '[]',
    img_url    TEXT,
    notes      TEXT,
    is_recipe  INTEGER DEFAULT 0,
    portion    REAL DEFAULT 100,
    unit       TEXT DEFAULT 'g',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS diary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    items      TEXT DEFAULT '[]',
    body_stats TEXT DEFAULT '{}',
    water      TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
  );
`);

// ── Migrations ─────────────────────────────────────────────────────────────
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
}

// Rebuild users table if it was created by an older incomplete schema
if (!columnExists('users', 'username')) {
  db.exec(`
    DROP TABLE IF EXISTS users;
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT,
      nickname      TEXT,
      birthday      TEXT,
      gender        TEXT,
      avatar_url    TEXT,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);
}

if (!columnExists('foods', 'user_id')) {
  db.exec(`ALTER TABLE foods ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
}
if (!columnExists('meals', 'user_id')) {
  db.exec(`ALTER TABLE meals ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
}

// diary needs a rebuild to get the composite UNIQUE(date, user_id)
if (!columnExists('diary', 'user_id')) {
  db.exec(`
    ALTER TABLE diary ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

    CREATE TABLE diary_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      items      TEXT DEFAULT '[]',
      body_stats TEXT DEFAULT '{}',
      water      TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, user_id)
    );
    INSERT INTO diary_new (id, user_id, date, items, body_stats, water, updated_at)
      SELECT id, user_id, date, items, body_stats, water, updated_at FROM diary;
    DROP TABLE diary;
    ALTER TABLE diary_new RENAME TO diary;
  `);
}

export default db;
