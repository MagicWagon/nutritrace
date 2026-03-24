import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || './nutritrace.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
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
    date       TEXT UNIQUE NOT NULL,
    items      TEXT DEFAULT '[]',
    body_stats TEXT DEFAULT '{}',
    water      TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

export default db;
