/**
 * image-cache.js — Download and cache server images to local device storage.
 *
 * During sync, scans all cached foods/meals/diary for server image URLs,
 * downloads them, saves to Capacitor Filesystem, and stores a mapping
 * so resolveAssetUrl() can return the local path when offline.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { getServerUrl } from './platform.js';
import { getDb } from './db-native.js';

const CACHE_DIR = 'image_cache';

/**
 * Download a single image from the server and cache it locally.
 * Returns the local file URI, or null on failure.
 */
async function _downloadImage(serverUrl) {
  if (!serverUrl || !serverUrl.startsWith('http')) return null;

  // Extract filename from URL
  const urlPath = new URL(serverUrl).pathname;
  const filename = urlPath.split('/').pop();
  if (!filename) return null;

  // Check if already cached
  try {
    const existing = await Filesystem.stat({
      path: `${CACHE_DIR}/${filename}`,
      directory: Directory.Data,
    });
    if (existing.uri) return existing.uri;
  } catch {
    // Not cached yet — download
  }

  try {
    const response = await fetch(serverUrl);
    if (!response.ok) return null;
    const blob = await response.blob();

    // Convert blob to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    await Filesystem.writeFile({
      path: `${CACHE_DIR}/${filename}`,
      data: base64,
      directory: Directory.Data,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      path: `${CACHE_DIR}/${filename}`,
      directory: Directory.Data,
    });

    return uri;
  } catch (e) {
    console.warn('[image-cache] Failed to download:', serverUrl, e.message);
    return null;
  }
}

/**
 * Build the image mapping table: server URL → local URI.
 * Stored in sync_meta as JSON so resolveAssetUrl can use it.
 */
async function _loadImageMap() {
  const db = await getDb();
  const r = await db.query(`SELECT value FROM sync_meta WHERE key = 'image_map'`, []);
  const row = r?.values?.[0];
  if (row?.value) {
    try { return JSON.parse(row.value); } catch { return {}; }
  }
  return {};
}

async function _saveImageMap(map) {
  const db = await getDb();
  await db.run(
    `INSERT INTO sync_meta (key, value) VALUES ('image_map', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(map)]
  );
}

/**
 * Scan all local data for server image URLs and download them.
 * Returns { total, downloaded, failed }.
 * Calls onProgress(downloaded, total) for UI updates.
 */
export async function cacheAllImages(onProgress) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return { total: 0, downloaded: 0, failed: 0 };

  const db = await getDb();
  const imageMap = await _loadImageMap();

  // Collect all unique image URLs from foods, meals, and diary items
  const urls = new Set();

  const foods = await db.query(`SELECT img_url FROM foods WHERE img_url IS NOT NULL AND img_url != '' AND deleted_at IS NULL`, []);
  for (const row of (foods?.values || [])) {
    if (row.img_url) urls.add(row.img_url.startsWith('http') ? row.img_url : serverUrl + row.img_url);
  }

  const meals = await db.query(`SELECT img_url FROM meals WHERE img_url IS NOT NULL AND img_url != '' AND deleted_at IS NULL`, []);
  for (const row of (meals?.values || [])) {
    if (row.img_url) urls.add(row.img_url.startsWith('http') ? row.img_url : serverUrl + row.img_url);
  }

  // Diary items have imgUrl embedded in JSON
  const diary = await db.query(`SELECT items FROM diary WHERE deleted_at IS NULL`, []);
  for (const row of (diary?.values || [])) {
    try {
      const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
      for (const item of items) {
        if (item.imgUrl) {
          urls.add(item.imgUrl.startsWith('http') ? item.imgUrl : serverUrl + item.imgUrl);
        }
      }
    } catch {}
  }

  // Filter out already-cached URLs
  const toDownload = [...urls].filter(u => !imageMap[u]);
  const total = toDownload.length;
  let downloaded = 0;
  let failed = 0;

  if (onProgress) onProgress(0, total);

  for (const url of toDownload) {
    const localUri = await _downloadImage(url);
    if (localUri) {
      imageMap[url] = localUri;
      downloaded++;
    } else {
      failed++;
    }
    if (onProgress) onProgress(downloaded + failed, total);
  }

  // Save updated map
  await _saveImageMap(imageMap);

  console.log(`[image-cache] Done: ${downloaded} downloaded, ${failed} failed, ${Object.keys(imageMap).length} total cached`);
  return { total, downloaded, failed };
}

/**
 * Resolve a server image URL to a local cached URI if available.
 * Used by resolveAssetUrl() in platform.js.
 */
let _cachedMap = null;
export async function resolveFromCache(serverUrl) {
  if (!_cachedMap) _cachedMap = await _loadImageMap();
  return _cachedMap[serverUrl] || null;
}

/** Clear the in-memory cache (call after sync updates the map) */
export function clearImageMapCache() {
  _cachedMap = null;
}
