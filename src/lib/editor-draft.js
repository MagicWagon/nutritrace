/**
 * Draft persistence for the FoodEditor + MealEditor forms.
 *
 * Motivation (#157): Samsung's camera-mode lmkd policy kills the WebView
 * renderer while the OS camera activity is foreground; Chromium then
 * kills the host process; Android cold-starts NutriTrace and the editor
 * remounts with an empty form. All in-progress typing is lost because
 * it lived only in Svelte state.
 *
 * Design:
 *   - Every field mutation is mirrored (debounced) into localStorage
 *     under a per-editor draft key so it survives process death.
 *   - On mount, an editor loads its draft and overlays it on top of
 *     the server-loaded (or empty) form, if the draft is fresh.
 *   - Save clears the draft. Back-out DOES NOT clear it: a user tapping
 *     Back and returning within the TTL restores their work, which is
 *     what the crash-recovery case needs (crash is indistinguishable
 *     from an intentional back-tap after process restart).
 *   - Draft keys are namespaced by editor and by target id (or 'new'
 *     for a brand-new entity) so an in-progress draft can never leak
 *     into an unrelated form.
 *
 * TTL is 4 hours: long enough for "start it now, come back after lunch"
 * yet short enough that a stale draft from days ago doesn't quietly
 * overwrite a fresh form.
 */

const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function _now() { return Date.now(); }

/** Build a namespaced draft key. `kind` = 'food' | 'meal'. `id` = the
 *  edited row's id, or null / undefined for a new (create) draft. */
export function draftKey(kind, id) {
  if (id != null) return `nt:${kind}:draft:edit:${id}`;
  return `nt:${kind}:draft:new`;
}

/** Persist `state` under `key`. Silently drops the largest field
 *  (imgUrl) and retries on QuotaExceededError so a fat inline photo
 *  can't cost the user their form data. */
export function saveDraft(key, state) {
  if (!key || typeof localStorage === 'undefined') return;
  const payload = { at: _now(), state };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return;
  } catch (e) {
    // QuotaExceededError or serialization failure. Try again without
    // the imgUrl (usually a base64 data URL running into the ~5MB
    // per-origin cap when multiple drafts are alive). Text fields
    // matter more to the user than the photo.
    if (state && typeof state === 'object' && state.imgUrl) {
      try {
        const trimmed = { ...state, imgUrl: '' };
        localStorage.setItem(key, JSON.stringify({ at: _now(), state: trimmed }));
      } catch { /* give up quietly — worst case the crash still empties the form */ }
    }
  }
}

/** Load the draft at `key` if it exists and is fresh (within `maxAgeMs`).
 *  Expired drafts are removed. Returns the state object or null. */
export function loadDraft(key, { maxAgeMs = TTL_MS } = {}) {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.at || !parsed.state) {
      localStorage.removeItem(key);
      return null;
    }
    if (_now() - parsed.at > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.state;
  } catch {
    return null;
  }
}

/** Remove the draft at `key`. Called after a successful save. */
export function clearDraft(key) {
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/** Debounced setter factory. Returns a fn that, when called with a
 *  state object, persists it after `delayMs` of quiet. Consecutive
 *  calls collapse into a single write, which is what the reactive
 *  `$: persist(food)` pattern needs (Svelte reactivity fires on
 *  every keystroke). */
export function makeDebouncedPersist(key, delayMs = 400) {
  let timer = null;
  return function persist(state) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveDraft(key, state), delayMs);
  };
}
