import jwt from 'jsonwebtoken';
import db from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'nutritrace-dev-secret-change-in-production';

/** Returns true if user management is active (at least one user exists) */
export function userMgmtActive() {
  return db.prepare('SELECT 1 FROM users LIMIT 1').get() != null;
}

/** Sign a JWT for a user row */
export function signToken(user) {
  const cfg = db.prepare("SELECT value FROM app_config WHERE key = 'session_hours'").get();
  const hours = cfg?.value != null && cfg.value !== '' ? parseInt(cfg.value) : 720;
  const opts = hours > 0 ? { expiresIn: `${hours}h` } : {};
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    opts
  );
}

/** Read session maxAge for cookies (in ms). 0 = no expiry → 10 years. */
export function sessionMaxAge() {
  const cfg = db.prepare("SELECT value FROM app_config WHERE key = 'session_hours'").get();
  const hours = cfg?.value != null && cfg.value !== '' ? parseInt(cfg.value) : 720;
  return hours > 0 ? hours * 60 * 60 * 1000 : 100 * 365 * 24 * 60 * 60 * 1000;
}

/** Attach req.user if a valid JWT cookie is present (non-blocking) */
export function authenticate(req, res, next) {
  const token = req.cookies?.nt_token;
  if (!token) { req.user = null; return next(); }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

/** Require a logged-in user when user management is active; pass through otherwise */
export function requireAuth(req, res, next) {
  if (!userMgmtActive()) return next();           // single-user mode — always allow
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

/** Require admin role */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
