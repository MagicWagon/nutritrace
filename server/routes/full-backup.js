import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import multer from 'multer';
import db from '../db.js';
import { seedSmtpFromEnv } from '../email.js';
import { seedAiFromEnv } from '../ai.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOADS_DIR = process.env.UPLOADS_PATH  || path.resolve(__dirname, '..', 'uploads');
// Default backups inside the uploads volume so they survive container restarts
const BACKUPS_DIR = process.env.BACKUPS_PATH  || path.join(UPLOADS_DIR, 'backups');

fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// Multer: stream to disk (temp dir) so large ZIPs don't OOM the container
const upload = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, os.tmpdir()) }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function restoreFromZip(zip) {
  const data = JSON.parse(zip.readAsText('database.json'));

  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_tokens').run();
    db.prepare('DELETE FROM invite_tokens').run();
    db.prepare('DELETE FROM user_settings').run();
    db.prepare('DELETE FROM app_config').run();
    db.prepare('DELETE FROM diary').run();
    db.prepare('DELETE FROM foods').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare('DELETE FROM users').run();

    const insUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, nickname, email, birthday, gender, avatar_url, role, created_at)
      VALUES (@id, @username, @password_hash, @full_name, @nickname, @email, @birthday, @gender, @avatar_url, @role, @created_at)
    `);
    for (const u of data.users || []) insUser.run(u);

    const insFood = db.prepare(`
      INSERT OR IGNORE INTO foods (id, user_id, name, brand, nutrition, portion, unit, img_url, notes, category, barcode, created_at)
      VALUES (@id, @user_id, @name, @brand, @nutrition, @portion, @unit, @img_url, @notes, @category, @barcode, @created_at)
    `);
    for (const f of data.foods || []) insFood.run(f);

    const insMeal = db.prepare(`
      INSERT OR IGNORE INTO meals (id, user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, created_at)
      VALUES (@id, @user_id, @name, @nutrition, @items, @img_url, @notes, @is_recipe, @portion, @unit, @created_at)
    `);
    for (const m of data.meals || []) insMeal.run(m);

    const insDiary = db.prepare(`
      INSERT OR IGNORE INTO diary (id, user_id, date, items, body_stats, water, updated_at)
      VALUES (@id, @user_id, @date, @items, @body_stats, @water, @updated_at)
    `);
    for (const d of data.diary || []) insDiary.run(d);

    const insSettings = db.prepare(`
      INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (@user_id, @key, @value)
    `);
    for (const s of data.user_settings || []) insSettings.run(s);

    const insConfig = db.prepare(`
      INSERT OR REPLACE INTO app_config (key, value) VALUES (@key, @value)
    `);
    for (const c of data.app_config || []) insConfig.run(c);
  })();

  // Restore images
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith('images/') || entry.isDirectory) continue;
    const rel  = entry.entryName.slice('images/'.length);
    const dest = path.join(UPLOADS_DIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }

  // Re-apply env-var config so lock flags always reflect the current environment,
  // regardless of what was in the backup (the backup may predate the lock flags).
  seedSmtpFromEnv();
  seedAiFromEnv();
}

function dumpDatabase() {
  return {
    users:         db.prepare('SELECT * FROM users').all(),
    foods:         db.prepare('SELECT * FROM foods').all(),
    meals:         db.prepare('SELECT * FROM meals').all(),
    diary:         db.prepare('SELECT * FROM diary').all(),
    user_settings: db.prepare('SELECT * FROM user_settings').all(),
    app_config:    db.prepare('SELECT * FROM app_config').all(),
  };
}

// ── POST /api/full-backup  — create a new backup ───────────────────────────
router.post('/', requireAdmin, (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename  = `nutritrace-backup-${timestamp}.zip`;
    const destPath  = path.join(BACKUPS_DIR, filename);

    const zip = new AdmZip();

    // 1. Database dump as JSON
    const dbDump = JSON.stringify(dumpDatabase(), null, 2);
    zip.addFile('database.json', Buffer.from(dbDump, 'utf8'));

    // 2. Uploaded images (skip the backups sub-directory)
    if (fs.existsSync(UPLOADS_DIR)) {
      const addDir = (dir, zipPath) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const zp   = zipPath ? `${zipPath}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (full === BACKUPS_DIR) continue; // never include backup archives
            addDir(full, zp);
          } else {
            zip.addFile(`images/${zp}`, fs.readFileSync(full));
          }
        }
      };
      addDir(UPLOADS_DIR, '');
    }

    zip.writeZip(destPath);

    const stat = fs.statSync(destPath);
    res.json({ filename, size: stat.size, createdAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/full-backup  — list backups ───────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, f));
        return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/full-backup/:name/download ───────────────────────────────────
router.get('/:name/download', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.name); // prevent path traversal
  const filePath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath, filename);
});

// ── DELETE /api/full-backup/:name ─────────────────────────────────────────
router.delete('/:name', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.name);
  const filePath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// ── POST /api/full-backup/:name/restore — restore from a server-side backup ─
router.post('/:name/restore', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.name);
  const filePath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  try {
    restoreFromZip(new AdmZip(filePath));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/full-backup/upload-restore — upload a ZIP and restore from it ─
router.post('/upload-restore', requireAdmin, upload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    restoreFromZip(new AdmZip(req.file.path));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

export default router;
