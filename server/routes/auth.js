import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { wrap } from '../logger.js';
import { signToken, userMgmtActive, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
  secure:   process.env.NODE_ENV === 'production',
};

function safeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

// ── Status: is user management active? ────────────────────────────────────
router.get('/status', wrap((req, res) => {
  res.json({ active: userMgmtActive() });
}));

// ── Who am I? ─────────────────────────────────────────────────────────────
router.get('/me', wrap((req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: user ? safeUser(user) : null });
}));

// ── Login ──────────────────────────────────────────────────────────────────
router.post('/login', wrap((req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.cookie('nt_token', signToken(user), COOKIE_OPTS);
  res.json({ user: safeUser(user) });
}));

// ── Logout ─────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('nt_token');
  res.json({ ok: true });
});

// ── Register (admin only, or first user = auto-admin) ─────────────────────
router.post('/register', wrap((req, res) => {
  const isFirst = !userMgmtActive();

  // Only first registration is open; subsequent require admin JWT
  if (!isFirst && (!req.user || req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { username, password, full_name, nickname, birthday, gender, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const hash = bcrypt.hashSync(password, 10);
  const assignedRole = isFirst ? 'admin' : (role === 'admin' ? 'admin' : 'user');

  const result = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, nickname, birthday, gender, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    username.trim().toLowerCase(), hash,
    full_name || null, nickname || null, birthday || null, gender || null, assignedRole
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

  // Auto-login the first user
  if (isFirst) {
    res.cookie('nt_token', signToken(user), COOKIE_OPTS);
  }

  res.json({ user: safeUser(user) });
}));

// ── Update own profile ─────────────────────────────────────────────────────
router.put('/profile', requireAuth, wrap((req, res) => {
  const { full_name, nickname, birthday, gender, avatar_url } = req.body;
  db.prepare(
    `UPDATE users SET full_name=?, nickname=?, birthday=?, gender=?, avatar_url=? WHERE id=?`
  ).run(full_name || null, nickname || null, birthday || null, gender || null, avatar_url || null, req.user.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: safeUser(user) });
}));

// ── Change own password ────────────────────────────────────────────────────
router.put('/password', requireAuth, wrap((req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
}));

// ── Admin: list users ──────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, wrap((req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at').all().map(safeUser);
  res.json(users);
}));

// ── Admin: delete user ─────────────────────────────────────────────────────
router.delete('/users/:id', requireAuth, requireAdmin, wrap((req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// ── Admin: reset another user's password ──────────────────────────────────
router.put('/users/:id/password', requireAuth, requireAdmin, wrap((req, res) => {
  const id = parseInt(req.params.id);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), id);
  res.json({ ok: true });
}));

// ── Admin: disable user management (delete all users) ─────────────────────
router.delete('/management', requireAuth, requireAdmin, wrap((req, res) => {
  db.prepare('DELETE FROM users').run();
  res.clearCookie('nt_token');
  res.json({ ok: true });
}));

export default router;
