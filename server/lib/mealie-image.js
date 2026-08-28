import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db.js';
import { logger } from '../logger.js';
import { userMgmtActive } from '../middleware/auth.js';
import { detectImageTypeFromBuffer } from './image-magic.js';

const UPLOADS_DIR = process.env.UPLOADS_PATH || './uploads';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EXTENSIONS = { jpeg: '.jpg', png: '.png', gif: '.gif', bmp: '.bmp', webp: '.webp', heic: '.heic', avif: '.avif' };

function normalizeUrl(value) {
  let normalized = String(value || '').trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) normalized = normalized.slice(1, -1);
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href.replace(/\/$/, '');
  } catch { return ''; }
}

function storedMealieUrl(userId) {
  const row = userId == null
    ? db.prepare(`SELECT value FROM user_settings WHERE key = 'mealieBaseUrl' AND deleted_at IS NULL LIMIT 1`).get()
    : db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'mealieBaseUrl' AND deleted_at IS NULL`).get(userId);
  return normalizeUrl(row?.value);
}

/** Authenticated, allowlisted copy of a private Mealie recipe image. */
export async function importMealieRecipeImage(descriptor, userId) {
  const requestedBase = normalizeUrl(descriptor?.base_url);
  const token = String(descriptor?.token || '');
  const recipeId = String(descriptor?.recipe_id || '').trim();
  if (!requestedBase || !token || !recipeId || recipeId.length > 200) return null;
  if (userMgmtActive() && storedMealieUrl(userId) !== requestedBase) {
    logger.warn('[recipe-import] Refused Mealie image from an unconfigured instance');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${requestedBase}/api/media/recipes/${encodeURIComponent(recipeId)}/images/original.webp`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100 || buffer.length > MAX_IMAGE_BYTES) return null;
    const type = detectImageTypeFromBuffer(buffer);
    if (!type) return null;
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
    const filename = `mealie-${hash}${EXTENSIONS[type] || '.jpg'}`;
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const destination = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, buffer, { flag: 'wx' });
    return `/uploads/${filename}`;
  } catch (error) {
    logger.warn(`[recipe-import] Mealie image import failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
