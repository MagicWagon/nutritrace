/**
 * sync.js — Differential sync engine for the Android app.
 *
 * Pushes local pending changes to the server, then pulls server changes.
 * Push first → pull second (so server has client's latest before responding).
 *
 * Uses server_time from pull response as last_sync_at (avoids clock skew).
 */

import { getServerUrl, getAuthToken, loadImageMap, setImageMap } from './platform.js';
import {
  dbGetPendingChanges, dbMarkSynced, dbSetServerId,
  dbGetSyncMeta, dbSetSyncMeta,
  dbUpsertFromServer, dbUpsertDiaryFromServer, dbUpsertWellnessFromServer,
  dbPurgeSoftDeleted,
} from './db-native.js';
import { writable } from 'svelte/store';

/** Sync state — reactive store for UI */
export const syncState = writable({
  syncing: false,
  phase: '',     // 'pushing' | 'pulling' | 'images' | ''
  progress: '',  // human-readable progress text
  lastSync: null,
  error: null,
  online: true,
});

let _syncing = false;

function _headers() {
  const h = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function _baseUrl() {
  return getServerUrl() || '';
}

/** Check if the server is reachable */
export async function checkOnline() {
  try {
    const res = await fetch(`${_baseUrl()}/api/health`, {
      headers: _headers(),
      signal: AbortSignal.timeout(5000),
    });
    const online = res.ok;
    syncState.update(s => ({ ...s, online }));
    return online;
  } catch {
    syncState.update(s => ({ ...s, online: false }));
    return false;
  }
}

/** Push local pending changes to the server */
async function pushChanges() {
  const pending = await dbGetPendingChanges();
  const hasPending = pending.foods.length || pending.meals.length || pending.diary.length;
  if (!hasPending) return;

  console.log(`[sync] pushing: ${pending.foods.length} foods, ${pending.meals.length} meals, ${pending.diary.length} diary`);

  // Build push payload with client_id and server_id
  const payload = {
    foods: pending.foods.map(f => ({
      client_id: f.id,
      server_id: f.server_id || null,
      name: f.name, brand: f.brand,
      nutrition: f.nutrition, portion: f.portion, unit: f.unit,
      img_url: f.img_url || f.imgUrl, notes: f.notes,
      category: (f.categories && f.categories[0]) || f.category,
      barcode: f.barcode,
      updated_at: f.updated_at,
      deleted_at: f.deleted_at || null,
    })),
    meals: pending.meals.map(m => ({
      client_id: m.id,
      server_id: m.server_id || null,
      name: m.name, nutrition: m.nutrition, items: m.items,
      img_url: m.img_url || m.imgUrl, notes: m.notes,
      is_recipe: m.is_recipe,
      portion: m.portion, unit: m.unit,
      updated_at: m.updated_at,
      deleted_at: m.deleted_at || null,
    })),
    diary: pending.diary.map(d => ({
      client_id: d.id,
      server_id: d.server_id || null,
      date: d.date,
      items: d.items,
      body_stats: d.body_stats,
      water: d.water,
      updated_at: d.updated_at,
      deleted_at: d.deleted_at || null,
    })),
  };

  console.log(`[sync] push payload: ${payload.foods.length} foods, ${payload.meals.length} meals, ${payload.diary.length} diary`);
  if (payload.foods.length) console.log('[sync] push foods:', payload.foods.map(f => `${f.name}(cid=${f.client_id},sid=${f.server_id},del=${f.deleted_at})`).join(', '));

  const res = await fetch(`${_baseUrl()}/api/sync/push`, {
    method: 'POST',
    headers: _headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[sync] push failed: ${res.status} ${errText}`);
    throw new Error(`Push failed: ${res.status}`);
  }
  const result = await res.json();
  console.log('[sync] push result:', JSON.stringify(result));

  // Update server_id mappings for newly created records
  for (const f of (result.foods || [])) {
    if (f.client_id && f.server_id) {
      await dbSetServerId('foods', f.client_id, f.server_id);
    }
  }
  for (const m of (result.meals || [])) {
    if (m.client_id && m.server_id) {
      await dbSetServerId('meals', m.client_id, m.server_id);
    }
  }
  for (const d of (result.diary || [])) {
    if (d.client_id && d.server_id) {
      await dbSetServerId('diary', d.client_id, d.server_id);
    }
  }

  // Mark all as synced
  await dbMarkSynced('foods', pending.foods.map(f => f.id));
  await dbMarkSynced('meals', pending.meals.map(m => m.id));
  await dbMarkSynced('diary', pending.diary.map(d => d.id));

  // Purge soft-deleted records that have been confirmed pushed
  await dbPurgeSoftDeleted('foods');
  await dbPurgeSoftDeleted('meals');
  await dbPurgeSoftDeleted('diary');

  console.log('[sync] push complete');
}

/** Pull server changes since last sync */
async function pullChanges() {
  const lastSync = await dbGetSyncMeta('last_sync_at') || '1970-01-01T00:00:00.000Z';

  console.log(`[sync] pulling since ${lastSync}`);

  const res = await fetch(`${_baseUrl()}/api/sync/pull?since=${encodeURIComponent(lastSync)}`, {
    headers: _headers(),
  });

  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = await res.json();

  // Apply foods
  for (const f of (data.foods || [])) {
    await dbUpsertFromServer('foods', f);
  }

  // Apply meals
  for (const m of (data.meals || [])) {
    await dbUpsertFromServer('meals', m);
  }

  // Apply diary
  for (const d of (data.diary || [])) {
    await dbUpsertDiaryFromServer(d);
  }

  // Apply wellness data (pull-only, server-generated)
  for (const w of (data.wellness || [])) {
    await dbUpsertWellnessFromServer(w);
  }

  // Save server time as last_sync_at
  if (data.server_time) {
    await dbSetSyncMeta('last_sync_at', data.server_time);
  }

  console.log(`[sync] pull complete: ${data.foods?.length || 0} foods, ${data.meals?.length || 0} meals, ${data.diary?.length || 0} diary, ${data.wellness?.length || 0} wellness`);
}

/** Full sync — push then pull then cache images */
export async function fullSync() {
  if (_syncing) return;
  // Don't sync without auth token (user logged out)
  if (!getAuthToken()) return;
  _syncing = true;
  syncState.update(s => ({ ...s, syncing: true, error: null, phase: 'pushing', progress: 'Pushing local changes…' }));

  try {
    const online = await checkOnline();
    if (!online) {
      syncState.update(s => ({ ...s, syncing: false, phase: '' }));
      _syncing = false;
      return;
    }

    syncState.update(s => ({ ...s, phase: 'pushing', progress: 'Pushing local changes…' }));
    await pushChanges();

    syncState.update(s => ({ ...s, phase: 'pulling', progress: 'Downloading data…' }));
    await pullChanges();

    // Cache images for offline use
    syncState.update(s => ({ ...s, phase: 'images', progress: 'Caching images…' }));
    try {
      const { cacheAllImages } = await import('./image-cache.js');
      await cacheAllImages((done, total) => {
        if (total > 0) {
          syncState.update(s => ({ ...s, progress: `Caching images… ${done}/${total}` }));
        }
      });
      // Reload image map into memory for resolveAssetUrl
      await loadImageMap();
    } catch (e) {
      console.warn('[sync] Image caching failed:', e.message);
    }

    const now = new Date().toISOString();
    syncState.update(s => ({ ...s, syncing: false, phase: '', progress: '', lastSync: now, online: true }));
    // Notify the app that sync completed — pages should refresh data
    window.dispatchEvent(new CustomEvent('nt:sync-complete'));
  } catch (e) {
    console.error('[sync] error:', e);
    syncState.update(s => ({ ...s, syncing: false, phase: '', progress: '', error: e.message }));
  } finally {
    _syncing = false;
  }
}

/** Start network monitoring — auto-sync when coming back online */
export function startNetworkMonitor() {
  // Listen for browser online/offline events
  window.addEventListener('online', () => {
    console.log('[sync] Network online detected');
    fullSync();
  });
  window.addEventListener('offline', () => {
    console.log('[sync] Network offline detected');
    syncState.update(s => ({ ...s, online: false }));
  });

  // Periodic health check every 30 seconds (window online/offline is unreliable on Android)
  setInterval(async () => {
    if (_syncing) return;
    const wasOnline = await new Promise(resolve => {
      syncState.subscribe(s => resolve(s.online))();
    });
    const nowOnline = await checkOnline();
    if (nowOnline && !wasOnline) {
      console.log('[sync] Server reachable again — syncing');
      fullSync();
    }
  }, 30000);
}

/** Quick push — debounced, for after local writes */
let _pushTimeout = null;
export function schedulePush() {
  clearTimeout(_pushTimeout);
  _pushTimeout = setTimeout(async () => {
    if (_syncing) return;
    try {
      const online = await checkOnline();
      if (online) await pushChanges();
    } catch (e) {
      console.error('[sync] scheduled push failed:', e);
    }
  }, 3000);
}
