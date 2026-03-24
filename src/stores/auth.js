import { writable } from 'svelte/store';

/** Currently logged-in user object, or null */
export const currentUser = writable(null);

/** Whether user management is enabled on the server */
export const userMgmtActive = writable(false);

/** Load auth state from the server (called once on app boot) */
export async function loadAuthState() {
  try {
    const [statusRes, meRes] = await Promise.all([
      fetch('/api/auth/status', { credentials: 'include' }),
      fetch('/api/auth/me',     { credentials: 'include' }),
    ]);
    const { active } = await statusRes.json();
    const { user }   = await meRes.json();
    userMgmtActive.set(active);
    currentUser.set(user);
    // Update user-scoped localStorage key prefix
    if (user) localStorage.setItem('wl:userId', String(user.id));
    else       localStorage.removeItem('wl:userId');
  } catch {
    userMgmtActive.set(false);
    currentUser.set(null);
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUser.set(null);
  localStorage.removeItem('wl:userId');
  location.reload();
}
