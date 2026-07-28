/**
 * version-source.js — resolves the server's APP_VERSION at boot.
 *
 * Reads package.json (the canonical version-bump target per
 * feedback_versioning). Falls back to 'unknown' if the file can't be
 * read; the update-check endpoint just returns available=false in that
 * case (safe default).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached = null;
function _read() {
  if (cached) return cached;
  try {
    const path = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    cached = pkg.version ? `v${pkg.version}` : 'unknown';
  } catch {
    cached = 'unknown';
  }
  return cached;
}

export const APP_VERSION = _read();
