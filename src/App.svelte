<script>
  import { onMount }   from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { portal } from './lib/portal.js';
  import Router, { location } from 'svelte-spa-router';

  import BottomNav from './components/layout/BottomNav.svelte';
  import Sidebar   from './components/layout/Sidebar.svelte';
  import Toast     from './components/ui/Toast.svelte';
  import { DB }    from './lib/db.js';
  import { navStyle, applyAccentColor, accentColor, applyAppearance, appearance, disableAnimations, sidebarPersistent } from './stores/settings.js';
  import { currentUser, userMgmtActive, loadAuthState } from './stores/auth.js';
  import { needsNativeSetup, isNative, getNativeMode, getServerUrl } from './lib/platform.js';
  import { writable } from 'svelte/store';

  // Sync state — mirrored from the real sync store (dynamically imported)
  const syncState = writable({ syncing: false, phase: '', progress: '', lastSync: null, error: null, online: true });
  $: _showSyncBar = isNative && getNativeMode() === 'server';
  let _syncJustFinished = false;
  let _syncHideTimer = null;
  let _wasSyncing = false;
  // Only show "Synced" when transitioning from syncing → done (not on cold start)
  $: {
    if ($syncState.syncing) {
      _wasSyncing = true;
      _syncJustFinished = false;
    } else if (_wasSyncing && $syncState.lastSync) {
      _wasSyncing = false;
      _syncJustFinished = true;
      clearTimeout(_syncHideTimer);
      _syncHideTimer = setTimeout(() => { _syncJustFinished = false; }, 3000);
    }
  }
  import NativeSetup from './routes/NativeSetup.svelte';

  // Show native setup wizard before anything else on first Android launch
  let showNativeSetup = needsNativeSetup();

  import Diary      from './routes/Diary.svelte';
  import Foods      from './routes/Foods.svelte';
  import FoodEditor from './routes/FoodEditor.svelte';
  import MealEditor from './routes/MealEditor.svelte';
  import Statistics from './routes/Statistics.svelte';
  import Goals      from './routes/Goals.svelte';
  import Settings   from './routes/Settings.svelte';
  import Wizard     from './routes/Wizard.svelte';
  import Login          from './routes/Login.svelte';
  import Profile        from './routes/Profile.svelte';
  import ForgotPassword from './routes/ForgotPassword.svelte';
  import ResetPassword  from './routes/ResetPassword.svelte';
  import AcceptInvite   from './routes/AcceptInvite.svelte';
  import AIFitBot   from './components/ai/AIFitBot.svelte';
  import Wellness   from './routes/Wellness.svelte';

  const routes = {
    '/':                Diary,
    '/foods':           Foods,
    '/foods/edit':      FoodEditor,
    '/foods/edit/:id':  FoodEditor,
    '/meal-editor':     MealEditor,
    '/meal-editor/:id': MealEditor,
    '/statistics':      Statistics,
    '/wellness':        Wellness,
    '/goals':           Goals,
    '/settings':        Settings,
    '/wizard':          Wizard,
    '/profile':           Profile,
    '/forgot-password':   ForgotPassword,
    '/reset-password':    ResetPassword,
    '/accept-invite':     AcceptInvite,
    '*':                  Diary,
  };

  const NAV_HIDDEN = ['/wizard', '/foods/edit', '/meal-editor', '/profile'];
  $: showNav       = !NAV_HIDDEN.some(p => $location.startsWith(p));
  const EDITOR_ROUTES = ['/foods/edit', '/meal-editor', '/profile', '/wizard'];
  $: _isEditorRoute = EDITOR_ROUTES.some(r => $location.startsWith(r));
  $: isEditor      = NAV_HIDDEN.some(p => $location.startsWith(p));
  $: _hasSidebar   = showNav && ($navStyle === 'sidebar' || $navStyle === 'both');
  $: sidebarPinned = _hasSidebar && $sidebarPersistent;
  $: showHamburger = _hasSidebar && !sidebarPinned;

  // Set --page-top so page headers clear the fixed hamburger button
  // and --sidebar-w so content shifts right when sidebar is persistent
  $: if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(
      '--page-top',
      showHamburger ? 'calc(var(--safe-top) + 62px)' : 'var(--safe-top)'
    );
    document.documentElement.style.setProperty(
      '--sidebar-w',
      sidebarPinned ? '280px' : '0px'
    );
  }

  let sidebarOpen = false;

  // Open/close sidebar as pinned state changes.
  // Track previous value so we close when transitioning pinned → not-pinned.
  let _prevPinned = false;
  function _syncSidebarToPin(pinned) {
    if (pinned) {
      sidebarOpen = true;
    } else if (_prevPinned) {
      // Was pinned, now not — dismiss the overlay so backdrop disappears
      sidebarOpen = false;
    }
    _prevPinned = pinned;
  }
  $: _syncSidebarToPin(sidebarPinned);

  // Also close immediately if sidebar nav is removed entirely (e.g. switched to bottom-only)
  $: if (!_hasSidebar) sidebarOpen = false;

  // Restore saved accent color and appearance on startup (also re-applies after loadServerSettings)
  $: applyAccentColor($accentColor);
  $: applyAppearance($appearance);

  // Apply/remove no-animations class when setting changes
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('no-animations', !!$disableAnimations);
  }

  onMount(async () => {
    // Android back button: navigate back or confirm exit
    if (isNative) {
      import('@capacitor/app').then(({ App }) => {
        let lastBack = 0;
        App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) {
            window.history.back();
          } else {
            const now = Date.now();
            if (now - lastBack < 2000) {
              App.exitApp();
            } else {
              lastBack = now;
              import('./stores/toast.js').then(({ showSuccess }) => {
                showSuccess('Tap again to exit');
              });
            }
          }
        });
      });
    }

    // Load auth state first (sets $currentUser and $userMgmtActive)
    await loadAuthState();

    // Show wizard on first launch:
    // - Native server mode: NEVER show wizard (server is already configured)
    // - Native local mode: show wizard for goals/units/profile setup
    // - Web: show wizard if no user logged in and no user management
    const _isNativeServer = isNative && getNativeMode() === 'server';
    const _isNativeLocal = isNative && getNativeMode() === 'local';
    if (!_isNativeServer && !DB.getSetting('setupComplete', false) && (!$currentUser || _isNativeLocal) && !$userMgmtActive) {
      window.location.hash = '#/wizard';
    }

    // Load cached image map BEFORE any data renders (must await, not fire-and-forget)
    if (isNative) {
      const { loadImageMap } = await import('./lib/platform.js');
      await loadImageMap();
    }

    // Start sync engine in native server-connected mode
    if (isNative && getNativeMode() === 'server') {
      import('./lib/sync.js').then((mod) => {
        mod.syncState.subscribe(v => syncState.set(v));
        mod.startNetworkMonitor();
        mod.fullSync(); // Initial sync (visible)
        // Periodic sync every 30 seconds (silent — only shows bar if changes found)
        setInterval(() => mod.fullSync(true), 30000);
        // Sync on app resume (visible)
        import('@capacitor/app').then(({ App }) => {
          App.addListener('resume', () => mod.fullSync());
        });
      });
    }

    // Migrate assistant name: 'Buddy' → 'FitBot'
    if (DB.getSetting('aiAssistantName', null) === 'Buddy') {
      DB.setSetting('aiAssistantName', 'FitBot');
    }

    // Migrate water containers: replace old defaults with current ones
    const _wc = DB.getSetting('waterContainers', null);
    if (!_wc || _wc.some(c => c.name === 'Small Glass' || c.name === '1 Gallon')) {
      DB.setSetting('waterContainers', [
        { id: '1', name: 'Small Bottle',    volumeMl: 250  },
        { id: '2', name: 'Standard Bottle', volumeMl: 500  },
        { id: '3', name: 'Large Bottle',    volumeMl: 1000 },
        { id: '4', name: 'Gallon Jug',      volumeMl: 3785 },
      ]);
    }
  });

  // Auth gate: bypass for password reset / invite pages
  const AUTH_BYPASS = ['/forgot-password', '/reset-password', '/accept-invite'];
  $: needsLogin = $userMgmtActive && !$currentUser && !AUTH_BYPASS.includes($location);
</script>

<!-- Native setup gate — shown on first launch on Android/iOS -->
{#if showNativeSetup}
  <NativeSetup />
  <Toast />

<!-- Login gate (when user management active and not authenticated) -->
{:else if needsLogin}
  <Login />
{:else}

<!-- Sidebar (hamburger menu) -->
<Sidebar bind:open={sidebarOpen} persistent={sidebarPinned} on:close={() => { if (!sidebarPinned) sidebarOpen = false; }} />

{#if showHamburger && $currentUser}
  <header class="app-topbar">
    <button
      class="hamburger"
      on:click={() => sidebarOpen = !sidebarOpen}
      aria-label="Open menu"
    >
      <span class="material-symbols-rounded">menu</span>
      {#if _showSyncBar}
        <span class="conn-badge" class:conn-online={$syncState.online} class:conn-offline={!$syncState.online}>
          <span class="material-symbols-rounded" style="font-size:10px">{$syncState.online ? 'cloud_done' : 'cloud_off'}</span>
        </span>
      {/if}
    </button>
    <div class="topbar-spacer"></div>
  </header>
{/if}

<!-- Sync status bar (native server mode only) -->
{#if _showSyncBar && !needsLogin && ($syncState.syncing || !$syncState.online || $syncState.error || _syncJustFinished)}
  <div class="sync-bar" class:sync-bar-error={$syncState.error} class:sync-bar-offline={!$syncState.online}
    use:portal transition:slide={{ duration: 200 }}>
    {#if $syncState.syncing}
      <span class="material-symbols-rounded sync-bar-icon sync-spin">sync</span>
      <span>{$syncState.progress || 'Syncing…'}</span>
    {:else if !$syncState.online}
      <span class="material-symbols-rounded sync-bar-icon">cloud_off</span>
      <span>Offline — changes saved locally</span>
    {:else if $syncState.error}
      <span class="material-symbols-rounded sync-bar-icon">error</span>
      <span>Sync error</span>
    {:else if _syncJustFinished}
      <span class="material-symbols-rounded sync-bar-icon">cloud_done</span>
      <span>Synced</span>
    {/if}
  </div>
{/if}

<!-- Page content -->
{#key $location}
  <div
    class="page-transition"
    class:has-topbar={showNav}
    in:fade={{ duration: $disableAnimations ? 0 : 180 }}
  >
    <Router {routes} />
  </div>
{/key}

{#if showNav && ($navStyle === 'bottom' || $navStyle === 'both')}
  <BottomNav />
{/if}

<Toast />
<AIFitBot />

{/if}

<!-- Toast must also render outside the login gate so errors show on the login screen -->
{#if needsLogin}<Toast />{/if}

<style>
  :global(body) { overflow-x: hidden; }

  /* Kill all transitions & animations when user enables "Disable animations" */
  :global(.no-animations *) {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }

  .app-topbar {
    position: fixed;
    top: var(--safe-top);
    left: 0; right: 0;
    height: 0; /* zero height — hamburger floats absolutely */
    z-index: 40;
    pointer-events: none;
  }

  .hamburger {
    position: fixed;
    top: calc(var(--safe-top) + 10px);
    left: 12px;
    width: 40px; height: 40px;
    border-radius: var(--radius-md);
    background: var(--surface-1);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    z-index: 41;
    pointer-events: all;
    color: var(--text-1);
    box-shadow: var(--shadow-sm);
    transition: background var(--dur-fast), transform var(--dur-fast) var(--ease-spring);
  }
  .hamburger:hover  { background: var(--surface-2); }
  .hamburger:active { transform: scale(0.92); }

  .topbar-spacer { flex: 1; }

  :global(.page-transition) {
    position: relative;
    min-height: 100dvh;
    width: calc(100% - var(--sidebar-w, 0px));
    margin-left: var(--sidebar-w, 0px);
    transition: margin-left 0.25s ease, width 0.25s ease;
  }
  :global(.bottom-nav) {
    left: var(--sidebar-w, 0px) !important;
    transition: left 0.25s ease !important;
  }
  :global(.diary-bottom-bar) {
    left: var(--sidebar-w, 0px) !important;
    transition: left 0.25s ease !important;
  }

  /* ── Connection badge on hamburger ── */
  .conn-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--surface-1);
    transition: background 0.3s;
  }
  .conn-online {
    background: var(--success, #22c55e);
    color: #fff;
  }
  .conn-offline {
    background: var(--error, #ef4444);
    color: #fff;
  }

  /* ── Sync status bar ── */
  .sync-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 16px;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    transition: background 0.3s, color 0.3s;
  }
  .sync-bar-offline {
    color: var(--text-3);
    background: color-mix(in srgb, var(--text-3) 8%, transparent);
    border-color: color-mix(in srgb, var(--text-3) 15%, transparent);
  }
  .sync-bar-error {
    color: var(--error, #f87171);
    background: color-mix(in srgb, var(--error, #f87171) 8%, transparent);
    border-color: color-mix(in srgb, var(--error, #f87171) 15%, transparent);
  }
  .sync-bar-icon { font-size: 16px; }
  @keyframes sync-spin { to { transform: rotate(360deg); } }
  .sync-spin { animation: sync-spin 1.2s linear infinite; }
</style>
