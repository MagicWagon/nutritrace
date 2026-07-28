/**
 * updates.js — In-app update checker.
 *
 * Checks GitHub Releases for newer versions of the app. On Android
 * (Capacitor native) downloads the APK asset and hands off to the
 * system installer. On PWA, the service worker handles client updates
 * itself; this module only checks the SERVER-update axis for admin UI.
 *
 * User-Agent is set explicitly per Fathom's self-update gotcha
 * (feature_traceapps_in_app_updates + project_fathom_self_update):
 * GitHub API rejects unauthenticated fetch() without a UA in some
 * scenarios and rate-limits harshly on shared IPs otherwise.
 *
 * Cadence:
 * - Check on mount, throttled to once per 24h via localStorage.
 * - "Check now" always runs immediately.
 * - No push notifications, no background poll.
 *

 * Channels (both platforms; Android uses this to pick the APK asset, PWA
 * uses it to pick which GitHub release the server-update banner
 * compares against):
 * - stable — /releases/latest (last tagged stable release)
 * - dev    — newest numbered pre-release matching v<M>.<m>.<p>-dev.<n>.
 *            NOT the literal `dev-latest` tag: that tag_name is the
 *            string "dev-latest", which parses as no valid semver so
 *            the version-compare would return equal and never prompt.
 *            Instead we list /releases, filter to prerelease=true with
 *            a numbered -dev.N tag, and pick the newest.
 */
import { APP_VERSION } from './version.js';
import { isNative } from './platform.js';

const GH_OWNER = 'TraceApps';
const GH_REPO  = 'nutritrace';
const APP_NAME = 'NutriTrace';
const CACHE_KEY_LAST_CHECK   = 'wl_updates_last_check';   // ISO string
const CACHE_KEY_LATEST       = 'wl_updates_latest';       // JSON blob
const CACHE_KEY_SKIP_VERSION = 'wl_updates_skip_version'; // version string user chose to skip
const CACHE_KEY_CHANNEL      = 'wl_updates_channel';      // 'stable' | 'dev'
const CACHE_KEY_AUTO_CHECK   = 'wl_updates_auto_check';   // '1' | '0'

const THROTTLE_MS = 24 * 60 * 60 * 1000;

const UA = `TraceApps-${APP_NAME}/${APP_VERSION}`;

/**
 * Parse a semver-like tag into { base:[M,m,p], pre:[…] }.
 * `pre` is the pre-release identifier chain (semver §9): each hyphen-
 * separated segment after the base version, split into dot-separated
 * identifiers. Numeric identifiers become numbers so `dev.10 > dev.9`.
 * Returns null for unparseable input.
 *
 * Examples:
 *   v1.0.4          → { base:[1,0,4], pre:[] }
 *   v1.1.0-dev.1    → { base:[1,1,0], pre:['dev', 1] }
 *   v1.1.0-dev.10   → { base:[1,1,0], pre:['dev', 10] }
 *   v1.1.0-rc.2     → { base:[1,1,0], pre:['rc', 2] }
 */
function _parseSemver(tag) {
  if (!tag) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(tag);
  if (!m) return null;
  const base = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  const pre = m[4]
    ? m[4].split('.').map(s => /^\d+$/.test(s) ? parseInt(s, 10) : s)
    : [];
  return { base, pre };
}

/**
 * Compare two semver-like tags. Returns 1 if a > b, -1 if a < b, 0 if equal
 * or unparseable. Follows the semver §11 precedence rules for pre-release
 * identifiers: numeric identifiers have lower precedence than
 * non-numeric; longer identifier chains outrank shorter identical
 * prefixes; a version with a pre-release identifier is LOWER precedence
 * than the same base without one (so `1.1.0 > 1.1.0-dev.1`, matching
 * "final release beats any pre-release for that version").
 */
export function compareSemver(a, b) {
  const pa = _parseSemver(a);
  const pb = _parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.base[i] > pb.base[i]) return 1;
    if (pa.base[i] < pb.base[i]) return -1;
  }
  // Base versions equal → pre-release comparison.
  // Empty pre-release (final release) outranks any pre-release.
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const ai = pa.pre[i], bi = pb.pre[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai > bi) return 1;
      if (ai < bi) return -1;
      continue;
    }
    if (typeof ai === 'number') return -1;
    if (typeof bi === 'number') return 1;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

export function getChannel() {
  try {
    return localStorage.getItem(CACHE_KEY_CHANNEL) || 'stable';
  } catch { return 'stable'; }
}

export function setChannel(channel) {
  try { localStorage.setItem(CACHE_KEY_CHANNEL, channel); } catch {}
}

export function getAutoCheck() {
  try {
    const v = localStorage.getItem(CACHE_KEY_AUTO_CHECK);
    return v === null ? true : v === '1';
  } catch { return true; }
}

export function setAutoCheck(on) {
  try { localStorage.setItem(CACHE_KEY_AUTO_CHECK, on ? '1' : '0'); } catch {}
}

export function getLastChecked() {
  try {
    const v = localStorage.getItem(CACHE_KEY_LAST_CHECK);
    return v ? new Date(v) : null;
  } catch { return null; }
}

export function getSkippedVersion() {
  try { return localStorage.getItem(CACHE_KEY_SKIP_VERSION) || ''; }
  catch { return ''; }
}

export function skipVersion(v) {
  try { localStorage.setItem(CACHE_KEY_SKIP_VERSION, v); } catch {}
}

/** Return the cached latest-release blob if within throttle window, else null. */
function _getCachedLatest() {
  try {
    const last = localStorage.getItem(CACHE_KEY_LAST_CHECK);
    if (!last) return null;
    if (Date.now() - new Date(last).getTime() > THROTTLE_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY_LATEST);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Fetch the latest release from GitHub for the current channel.
 * Returns { version, notes, notesUrl, publishedAt, apkAsset } or null on failure.
 * apkAsset is { name, url, size } or null if no APK attached.
 *
 * When `force` is false and a valid cached result exists (within 24h),
 * returns the cached result without hitting the network.
 */
export async function checkForUpdate({ force = false } = {}) {
  if (!force) {
    const cached = _getCachedLatest();
    if (cached) return cached;
  }
  const channel = getChannel();
  const headers = {
    'Accept':     'application/vnd.github+json',
    'User-Agent': UA,
  };
  try {
    let data;
    if (channel === 'dev' || channel === 'beta') {
      // Beta is the legacy alias for Dev; kept accepted so older cached
      // values still resolve. List up to 20 recent releases and pick the
      // newest that's flagged prerelease with a numbered -dev.N tag.
      // Ignoring the `dev-latest` floating tag itself (its tag_name is
      // the string literal, not a semver).
      const listRes = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=20`,
        { headers },
      );
      if (!listRes.ok) throw new Error(`GitHub API ${listRes.status}`);
      const list = await listRes.json();
      const devTag = /^v\d+\.\d+\.\d+-dev\.\d+$/;
      const devRelease = list.find(r => r.prerelease && devTag.test(r.tag_name || ''));
      if (!devRelease) {
        // No numbered dev release exists yet; nothing to offer.
        return null;
      }
      data = devRelease;
    } else {
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`,
        { headers },
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      data = await res.json();
    }
    const apkAsset = (data.assets || []).find(a =>
      a.name && a.name.toLowerCase().endsWith('.apk')
    );
    const result = {
      version:     data.tag_name || data.name || '',
      name:        data.name || '',
      notes:       data.body || '',
      notesUrl:    data.html_url || '',
      publishedAt: data.published_at || '',
      apkAsset:    apkAsset ? {
        name: apkAsset.name,
        url:  apkAsset.browser_download_url,
        size: apkAsset.size,
      } : null,
    };
    try {
      localStorage.setItem(CACHE_KEY_LAST_CHECK, new Date().toISOString());
      localStorage.setItem(CACHE_KEY_LATEST, JSON.stringify(result));
    } catch {}
    return result;
  } catch (e) {
    console.warn('[updates] check failed:', e?.message || e);
    return null;
  }
}

/** True when `latest.version` is strictly greater than the running APP_VERSION. */
export function isUpdateAvailable(latest) {
  if (!latest || !latest.version) return false;
  return compareSemver(latest.version, APP_VERSION) > 0;
}

/**
 * Download the APK to app storage and hand off to the Android system installer.
 * Android/Capacitor-only. Progress callback receives 0-100.
 * Throws on non-native platforms or download failure.
 */
export async function downloadAndInstallApk(latest, onProgress) {
  if (!isNative) throw new Error('APK install only available in the Android app');
  if (!latest?.apkAsset) throw new Error('No APK asset in this release');
  const { Filesystem, Directory } = await import('@capacitor/filesystem');

  // Manual fetch + write so we can surface progress. Capacitor's
  // Filesystem.downloadFile is simpler but its progress reporting is
  // spotty on older Capacitor versions and silently drops on chunked
  // transfer without a Content-Length header.
  const res = await fetch(latest.apkAsset.url, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = latest.apkAsset.size || parseInt(res.headers.get('content-length') || '0', 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && total > 0) onProgress(Math.min(99, Math.floor(received / total * 100)));
  }
  const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
  const base64 = await _blobToBase64(blob);

  const path = `updates/${latest.apkAsset.name}`;
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  if (onProgress) onProgress(100);

  // Hand off to system installer. @capacitor-community/file-opener wraps
  // Android's Intent.ACTION_VIEW + FileProvider dance, resolving the
  // file:// URI to a content:// URI via the app's FileProvider (declared
  // in AndroidManifest.xml with authority ${applicationId}.fileprovider
  // and file-paths pointing at files-path updates/). The system routes
  // application/vnd.android.package-archive to the package installer,
  // which prompts the user for install approval.
  const { FileOpener } = await import('@capacitor-community/file-opener');
  try {
    await FileOpener.open({
      filePath: uri,
      contentType: 'application/vnd.android.package-archive',
    });
  } catch (e) {
    throw new Error(`Could not open installer: ${e?.message || e}`);
  }
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Format an ISO date for the "Last checked: X ago" label. */
export function formatAgo(dateOrIso) {
  if (!dateOrIso) return '';
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

/**
 * Fetch server-update status (PWA + admin only path). Passes the user's
 * current channel to the server so a Beta-channel PWA admin sees
 * whether the running server is behind the latest dev-latest release
 * (not the stable one). Server caches per-channel.
 *
 * Returns { current, latest, channel, available, notes_url, checked_at }
 * or null on failure / non-admin / native app (not applicable).
 */
export async function checkServerUpdate() {
  if (isNative) return null; // Server-update banner is PWA-only.
  try {
    const { apiUrl } = await import('./platform.js');
    const channel = (getChannel() === 'dev' || getChannel() === 'beta') ? 'dev' : 'stable';
    const res = await fetch(apiUrl(`/api/updates/server-status?channel=${channel}`), {
      credentials: 'include',
    });
    if (res.status === 403) return null; // Non-admin — no banner.
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
