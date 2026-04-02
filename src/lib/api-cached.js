/**
 * api-cached.js — Cached API layer for native server-connected mode.
 *
 * Wraps _NtApiHttp: on success caches to local SQLite, on failure serves from cache.
 * Writes go to local SQLite immediately (with sync_status='pending') AND to server.
 * If server write fails (offline), the sync engine pushes later.
 *
 * Provides the same interface as NtApi / NtApiNative.
 */

import {
  dbGetFoods, dbGetFood, dbCreateFood, dbUpdateFood, dbDeleteFood, dbCopyFood,
  dbGetMeals, dbGetMeal, dbCreateMeal, dbUpdateMeal, dbDeleteMeal, dbCopyMeal,
  dbGetDiaryDate, dbSaveDiaryDate, dbGetAllDiary,
  dbGetWellness, dbUpsertWellness,
  dbUpsertFromServer, dbUpsertDiaryFromServer, dbUpsertWellnessFromServer,
} from './db-native.js';
import { getServerUrl, getAuthToken, resolveAssetUrl } from './platform.js';
import { schedulePush } from './sync.js';

function _headers() {
  const h = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function _base() {
  return getServerUrl() || '';
}

async function _serverFetch(method, path, body) {
  const res = await fetch(_base() + path, {
    method,
    headers: _headers(),
    credentials: 'include',
    cache: 'no-store',
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// Field mapping helpers (same as NtApiHttp)
function _foodFromApi(row) {
  if (!row) return null;
  const { img_url, category, ...rest } = row;
  return { ...rest, imgUrl: resolveAssetUrl(img_url) || '', categories: category ? [category] : [] };
}

function _foodToApi(food) {
  const { imgUrl, img_url, categories, category, ...rest } = food;
  return { ...rest, img_url: imgUrl || img_url || null, category: (categories && categories[0]) || category || null };
}

function _mealFromApi(row) {
  if (!row) return null;
  const { img_url, ...rest } = row;
  return { ...rest, imgUrl: resolveAssetUrl(img_url) || '' };
}

function _mealToApi(meal) {
  const { imgUrl, img_url, ...rest } = meal;
  return { ...rest, img_url: imgUrl || img_url || null };
}

export const NtApiCached = {

  // ── Foods ─────────────────────────────────────────────────────────────

  async getFoods() {
    // Serve from local cache first (instant), refresh from server in background
    const local = await dbGetFoods().catch(() => []);
    if (local.length > 0) {
      // Update from server in background
      _serverFetch('GET', '/api/foods').then(serverFoods => {
        for (const f of serverFoods) dbUpsertFromServer('foods', f).catch(() => {});
      }).catch(() => {});
      return local.map(_foodFromApi);
    }
    // No local cache — must fetch from server
    try {
      const serverFoods = await _serverFetch('GET', '/api/foods');
      Promise.resolve().then(async () => {
        for (const f of serverFoods) await dbUpsertFromServer('foods', f).catch(() => {});
      });
      return serverFoods.map(_foodFromApi);
    } catch {
      return [];
    }
  },

  async getGroupFoods() {
    try {
      const r = await _serverFetch('GET', '/api/foods?group=1');
      return r.map(_foodFromApi);
    } catch {
      return this.getFoods();
    }
  },

  async getFood(id) {
    try {
      const r = await _serverFetch('GET', `/api/foods/${id}`);
      return _foodFromApi(r);
    } catch {
      const local = await dbGetFood(id);
      return _foodFromApi(local);
    }
  },

  async createFood(data) {
    // Write locally first
    const local = await dbCreateFood(_foodToApi(data));
    // Try server
    try {
      const server = await _serverFetch('POST', '/api/foods', _foodToApi(data));
      if (server?.id && local?.id) {
        const { dbSetServerId, dbMarkSynced } = await import('./db-native.js');
        await dbSetServerId('foods', local.id, server.id);
        await dbMarkSynced('foods', [local.id]);
      }
      return _foodFromApi(server);
    } catch {
      schedulePush();
      return _foodFromApi(local);
    }
  },

  async updateFood(id, data) {
    const local = await dbUpdateFood(id, _foodToApi(data));
    try {
      // Use server_id if available
      const serverId = local?.server_id || id;
      const server = await _serverFetch('PUT', `/api/foods/${serverId}`, _foodToApi(data));
      return _foodFromApi(server);
    } catch {
      schedulePush();
      return _foodFromApi(local);
    }
  },

  async deleteFood(id) {
    await dbDeleteFood(id);
    try {
      const local = await dbGetFood(id);
      const serverId = local?.server_id || id;
      await _serverFetch('DELETE', `/api/foods/${serverId}`);
    } catch {
      schedulePush();
    }
    return { ok: true };
  },

  async shareFood(id, visibility, user_ids) {
    try { return await _serverFetch('PATCH', `/api/foods/${id}/share`, { visibility, user_ids }); }
    catch { return { ok: true }; }
  },

  async copyFood(id) {
    try {
      const r = await _serverFetch('POST', `/api/foods/${id}/copy`, {});
      return _foodFromApi(r);
    } catch {
      return _foodFromApi(await dbCopyFood(id));
    }
  },

  // ── Meals & Recipes ───────────────────────────────────────────────────

  async getMeals() {
    const local = await dbGetMeals(false).catch(() => []);
    if (local.length > 0) {
      _serverFetch('GET', '/api/meals').then(r => { for (const m of r) dbUpsertFromServer('meals', m).catch(() => {}); }).catch(() => {});
      return local.map(_mealFromApi);
    }
    try {
      const r = await _serverFetch('GET', '/api/meals');
      Promise.resolve().then(async () => { for (const m of r) await dbUpsertFromServer('meals', m).catch(() => {}); });
      return r.map(_mealFromApi);
    } catch { return []; }
  },

  async getGroupMeals() {
    try { return (await _serverFetch('GET', '/api/meals?group=1')).map(_mealFromApi); }
    catch { return this.getMeals(); }
  },

  async getRecipes() {
    const local = await dbGetMeals(true).catch(() => []);
    if (local.length > 0) {
      _serverFetch('GET', '/api/meals?recipes=1').then(r => { for (const m of r) dbUpsertFromServer('meals', m).catch(() => {}); }).catch(() => {});
      return local.map(_mealFromApi);
    }
    try {
      const r = await _serverFetch('GET', '/api/meals?recipes=1');
      Promise.resolve().then(async () => { for (const m of r) await dbUpsertFromServer('meals', m).catch(() => {}); });
      return r.map(_mealFromApi);
    } catch { return []; }
  },

  async getGroupRecipes() {
    try { return (await _serverFetch('GET', '/api/meals?recipes=1&group=1')).map(_mealFromApi); }
    catch { return this.getRecipes(); }
  },

  async getMeal(id) {
    try { return _mealFromApi(await _serverFetch('GET', `/api/meals/${id}`)); }
    catch { return _mealFromApi(await dbGetMeal(id)); }
  },

  async createMeal(data) {
    const local = await dbCreateMeal(_mealToApi(data));
    try {
      const server = await _serverFetch('POST', '/api/meals', _mealToApi(data));
      if (server?.id && local?.id) {
        const { dbSetServerId, dbMarkSynced } = await import('./db-native.js');
        await dbSetServerId('meals', local.id, server.id);
        await dbMarkSynced('meals', [local.id]);
      }
      return _mealFromApi(server);
    } catch {
      schedulePush();
      return _mealFromApi(local);
    }
  },

  async updateMeal(id, data) {
    const local = await dbUpdateMeal(id, _mealToApi(data));
    try {
      const serverId = local?.server_id || id;
      return _mealFromApi(await _serverFetch('PUT', `/api/meals/${serverId}`, _mealToApi(data)));
    } catch {
      schedulePush();
      return _mealFromApi(local);
    }
  },

  async deleteMeal(id) {
    await dbDeleteMeal(id);
    try {
      const local = await dbGetMeal(id);
      await _serverFetch('DELETE', `/api/meals/${local?.server_id || id}`);
    } catch { schedulePush(); }
    return { ok: true };
  },

  async shareMeal(id, visibility, user_ids) {
    try { return await _serverFetch('PATCH', `/api/meals/${id}/share`, { visibility, user_ids }); }
    catch { return { ok: true }; }
  },

  async copyMeal(id) {
    try { return _mealFromApi(await _serverFetch('POST', `/api/meals/${id}/copy`, {})); }
    catch { return _mealFromApi(await dbCopyMeal(id)); }
  },

  // ── Diary ─────────────────────────────────────────────────────────────

  async getDiaryDate(date) {
    try {
      const r = await _serverFetch('GET', `/api/diary/${date}`);
      if (r) await dbUpsertDiaryFromServer(r).catch(() => {});
      return r || { date, items: [], body_stats: {}, water: [] };
    } catch {
      const local = await dbGetDiaryDate(date);
      return local || { date, items: [], body_stats: {}, water: [] };
    }
  },

  async saveDiaryDate(date, data) {
    await dbSaveDiaryDate(date, data);
    try {
      return await _serverFetch('PUT', `/api/diary/${date}`, data);
    } catch {
      schedulePush();
      return await dbGetDiaryDate(date);
    }
  },

  async getAllDiary() {
    try { return await _serverFetch('GET', '/api/diary'); }
    catch { return await dbGetAllDiary(); }
  },

  // ── Users (server-only) ───────────────────────────────────────────────

  async getUsersList() {
    try { return await _serverFetch('GET', '/api/auth/users/list'); }
    catch { return []; }
  },

  // ── App config (server-only) ──────────────────────────────────────────

  async getAppConfig() {
    try { return await _serverFetch('GET', '/api/app-config'); }
    catch { return { food_sharing_enabled: false }; }
  },

  async getSharingStatus() {
    try { return await _serverFetch('GET', '/api/app-config/sharing'); }
    catch { return { enabled: false }; }
  },

  // ── Upload ────────────────────────────────────────────────────────────

  async uploadImage(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(_base() + '/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.url;
  },

  // ── Pass-through for NtApi.post/get/put/del ───────────────────────────
  get(path)           { return _serverFetch('GET', path); },
  post(path, body)    { return _serverFetch('POST', path, body); },
  put(path, body)     { return _serverFetch('PUT', path, body); },
  patch(path, body)   { return _serverFetch('PATCH', path, body); },
  del(path)           { return _serverFetch('DELETE', path); },
};
