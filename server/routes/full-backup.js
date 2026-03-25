import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import db from '../db.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKUPS_DIR = process.env.BACKUPS_PATH || path.resolve(__dirname, '..', 'data', 'backups');
const UPLOADS_DIR = process.env.UPLOADS_PATH  || path.resolve(__dirname, '..', 'uploads');

fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
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

    // 2. Uploaded images
    if (fs.existsSync(UPLOADS_DIR)) {
      const addDir = (dir, zipPath) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const zp   = zipPath ? `${zipPath}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
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

// ── POST /api/full-backup/:name/restore ───────────────────────────────────
router.post('/:name/restore', requireAdmin, (req, res) => {
  const filename = path.basename(req.params.name);
  const filePath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  try {
    const zip  = new AdmZip(filePath);
    const data = JSON.parse(zip.readAsText('database.json'));

    // Restore database in a transaction
    db.transaction(() => {
      // Clear all data
      db.prepare('DELETE FROM password_reset_tokens').run();
      db.prepare('DELETE FROM invite_tokens').run();
      db.prepare('DELETE FROM user_settings').run();
      db.prepare('DELETE FROM app_config').run();
      db.prepare('DELETE FROM diary').run();
      db.prepare('DELETE FROM foods').run();
      db.prepare('DELETE FROM meals').run();
      db.prepare('DELETE FROM users').run();

      // Restore users
      const insUser = db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, full_name, nickname, email, birthday, gender, avatar_url, role, created_at)
        VALUES (@id, @username, @password_hash, @full_name, @nickname, @email, @birthday, @gender, @avatar_url, @role, @created_at)
      `);
      for (const u of data.users || []) insUser.run(u);

      // Restore foods
      const insFood = db.prepare(`
        INSERT OR IGNORE INTO foods (id, user_id, name, brand, nutrition, portion, unit, img_url, notes, category, barcode, created_at)
        VALUES (@id, @user_id, @name, @brand, @nutrition, @portion, @unit, @img_url, @notes, @category, @barcode, @created_at)
      `);
      for (const f of data.foods || []) insFood.run(f);

      // Restore meals
      const insMeal = db.prepare(`
        INSERT OR IGNORE INTO meals (id, user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, created_at)
        VALUES (@id, @user_id, @name, @nutrition, @items, @img_url, @notes, @is_recipe, @portion, @unit, @created_at)
      `);
      for (const m of data.meals || []) insMeal.run(m);

      // Restore diary
      const insDiary = db.prepare(`
        INSERT OR IGNORE INTO diary (id, user_id, date, items, body_stats, water, updated_at)
        VALUES (@id, @user_id, @date, @items, @body_stats, @water, @updated_at)
      `);
      for (const d of data.diary || []) insDiary.run(d);

      // Restore user_settings
      const insSettings = db.prepare(`
        INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (@user_id, @key, @value)
      `);
      for (const s of data.user_settings || []) insSettings.run(s);

      // Restore app_config
      const insConfig = db.prepare(`
        INSERT OR REPLACE INTO app_config (key, value) VALUES (@key, @value)
      `);
      for (const c of data.app_config || []) insConfig.run(c);
    })();

    // Restore images
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith('images/') || entry.isDirectory) continue;
      const rel    = entry.entryName.slice('images/'.length);
      const dest   = path.join(UPLOADS_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
