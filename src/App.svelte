<script>
  import { onMount }   from 'svelte';
  import { fade } from 'svelte/transition';
  import Router, { location } from 'svelte-spa-router';

  import BottomNav from './components/layout/BottomNav.svelte';
  import Sidebar   from './components/layout/Sidebar.svelte';
  import Toast     from './components/ui/Toast.svelte';
  import { DB }    from './lib/db.js';
  import { navStyle, applyAccentColor, accentColor, disableAnimations, sidebarPersistent } from './stores/settings.js';
  import { currentUser, userMgmtActive, loadAuthState } from './stores/auth.js';

  import Diary      from './routes/Diary.svelte';
  import Foods      from './routes/Foods.svelte';
  import FoodEditor from './routes/FoodEditor.svelte';
  import MealEditor from './routes/MealEditor.svelte';
  import Statistics from './routes/Statistics.svelte';
  import Goals      from './routes/Goals.svelte';
  import Settings   from './routes/Settings.svelte';
  import Wizard     from './routes/Wizard.svelte';
  import Water      from './routes/Water.svelte';
  import Login      from './routes/Login.svelte';
  import Profile    from './routes/Profile.svelte';
  import AIBuddy    from './components/ai/AIBuddy.svelte';

  const routes = {
    '/':                Diary,
    '/foods':           Foods,
    '/foods/edit':      FoodEditor,
    '/foods/edit/:id':  FoodEditor,
    '/meal-editor':     MealEditor,
    '/meal-editor/:id': MealEditor,
    '/water':           Water,
    '/statistics':      Statistics,
    '/goals':           Goals,
    '/settings':        Settings,
    '/wizard':          Wizard,
    '/profile':         Profile,
    '*':                Diary,
  };

  const NAV_HIDDEN = ['/wizard', '/foods/edit', '/meal-editor', '/profile'];
  $: showNav       = !NAV_HIDDEN.some(p => $location.startsWith(p));
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

  // Restore saved accent color on startup
  $: applyAccentColor($accentColor);

  // Apply/remove no-animations class when setting changes
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('no-animations', !!$disableAnimations);
  }

  onMount(async () => {
    // Load auth state first (sets $currentUser and $userMgmtActive)
    await loadAuthState();

    // Skip wizard if user is logged in — their account is already set up
    if (!DB.getSetting('setupComplete', false) && !$currentUser) {
      window.location.hash = '#/wizard';
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

  // Auth gate: when user management is active and no user is logged in, show Login
  $: needsLogin = $userMgmtActive && !$currentUser;
</script>

<!-- Login gate (when user management active and not authenticated) -->
{#if needsLogin}
  <Login />
{:else}

<!-- Sidebar (hamburger menu) -->
<Sidebar bind:open={sidebarOpen} persistent={sidebarPinned} on:close={() => { if (!sidebarPinned) sidebarOpen = false; }} />

{#if showHamburger}
  <header class="app-topbar">
    <button
      class="hamburger"
      on:click={() => sidebarOpen = !sidebarOpen}
      aria-label="Open menu"
    >
      <span class="material-symbols-rounded">menu</span>
    </button>
    <div class="topbar-spacer"></div>
  </header>
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
<AIBuddy />

{/if}

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
</style>
