import { writable } from 'svelte/store';
import { loadServerSettings } from './settings.js';
import { isNative, getServerUrl, getAuthToken } from '../lib/platform.js';

// In native server-connected mode, prefix API calls with the server URL
function _apiUrl(path) {
  if (isNative) {
    const url = getServerUrl();
    if (url) return url + path;
  }
  return path; // relative — same origin (web or native local)
}

/** Currently logged-in user object, or null */
export const currentUser = writable(null);

/** Whether user management is enabled on the server */
export const userMgmtActive = writable(false);

// Synthetic local user for native standalone mode (no server configured)
const LOCAL_USER = {
  id:        1,
  username:  'local',
  full_name: 'Local User',
  nickname:  null,
  role:      'admin',
  email:     null,
  avatar_url: null,
  birthday:  null,
  gender:    null,
};

/** Load auth state — handles both server mode and native standalone mode */
export async function loadAuthState() {
  // Native standalone: use the synthetic local user, skip all HTTP calls
  if (isNative && !getServerUrl()) {
    userMgmtActive.set(false);
    currentUser.set(LOCAL_USER);
    localStorage.setItem('wl:userId', String(LOCAL_USER.id));
    return;
  }

  try {
    let active, user;
    if (isNative && getServerUrl()) {
      // Native server mode: use CapacitorHttp (shares cookies with native HTTP layer)
      const { CapacitorHttp } = await import('@capacitor/core');
      const serverUrl = getServerUrl();
      const token = getAuthToken();
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
      const [statusRes, meRes] = await Promise.all([
        CapacitorHttp.get({ url: `${serverUrl}/api/auth/status`, headers: authHeaders }),
        CapacitorHttp.get({ url: `${serverUrl}/api/auth/me`, headers: authHeaders }),
      ]);
      const statusData = typeof statusRes.data === 'string' ? JSON.parse(statusRes.data) : statusRes.data;
      const meData     = typeof meRes.data === 'string' ? JSON.parse(meRes.data) : meRes.data;
      active = statusData.active;
      user   = meData.user || null;
    } else {
      const [statusRes, meRes] = await Promise.all([
        fetch(_apiUrl('/api/auth/status'), { credentials: 'include' }),
        fetch(_apiUrl('/api/auth/me'),     { credentials: 'include' }),
      ]);
      const statusData = await statusRes.json();
      const meData     = await meRes.json();
      active = statusData.active;
      user   = meData.user || null;
    }
    userMgmtActive.set(!!active);
    currentUser.set(user);
    if (user) localStorage.setItem('wl:userId', String(user.id));
    else       localStorage.removeItem('wl:userId');
    if (user) await loadServerSettings();
  } catch {
    userMgmtActive.set(false);
    currentUser.set(null);
  }
}

export async function logout() {
  await fetch(_apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' });
  // Clear all user-scoped settings from localStorage (wl_u{id}_* keys)
  const userId = localStorage.getItem('wl:userId');
  if (userId) {
    const prefix = `wl_u${userId}_`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }
  localStorage.removeItem('wl:userId');
  currentUser.set(null);
  // needsLogin in App.svelte reacts immediately — no reload needed
}
