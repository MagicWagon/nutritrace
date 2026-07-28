<script>
  /**
   * SettingsUpdates — in-app update UX, modeled on Fathom's UpdatesScreen.
   *
   * Cross-platform behavior:
   *   Android APK  : GitHub Releases check + APK download + system installer handoff.
   *                  Channel toggle: Stable (`/releases/latest`) or Dev (`/releases/tags/dev-latest`).
   *   PWA          : Client-update is handled by the service worker (App.svelte
   *                  listens for `updatefound` and shows an inline "Reload"
   *                  toast). This component just shows an admin-only server-
   *                  update banner when the running server version is behind
   *                  the latest tagged release.
   *   Local Android: Same as regular Android (client-update only).
   *
   * See feature_traceapps_in_app_updates.md for the full spec.
   */
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { APP_VERSION } from '../../lib/version.js';
  import { isNative } from '../../lib/platform.js';
  import { currentUser } from '../../stores/auth.js';
  import { showSuccess, showError } from '../../stores/toast.js';
  import {
    checkForUpdate, isUpdateAvailable, downloadAndInstallApk,
    getChannel, setChannel, getAutoCheck, setAutoCheck,
    getLastChecked, formatAgo, checkServerUpdate,
    skipVersion,
  } from '../../lib/updates.js';

  let channel     = getChannel();
  let autoCheck   = getAutoCheck();
  let checking    = false;
  let latest      = null;         // { version, notes, notesUrl, publishedAt, apkAsset }
  let serverInfo  = null;         // { current, latest, available, notes_url }
  let lastChecked = getLastChecked();
  let error       = '';
  let downloading = false;
  let downloadPct = 0;
  let installFailed = '';

  $: isAdmin = $currentUser?.role === 'admin';
  $: available = latest && isUpdateAvailable(latest);
  $: showApkPanel     = isNative;                       // Android only.
  $: showServerPanel  = !isNative && isAdmin;           // PWA admin only.

  onMount(async () => {
    // Auto-check (throttled internally to once per 24h) — runs on mount so
    // opening Settings surfaces any pending update without a manual poke.
    if (autoCheck) {
      await Promise.all([
        isNative ? doCheck(false) : Promise.resolve(),
        !isNative && isAdmin ? doServerCheck() : Promise.resolve(),
      ]);
    }
  });

  async function doCheck(force = true) {
    checking = true;
    error = '';
    try {
      latest = await checkForUpdate({ force });
      lastChecked = getLastChecked();
      if (!latest) error = $_('updates.check_failed');
    } finally {
      checking = false;
    }
  }

  async function doServerCheck() {
    try {
      serverInfo = await checkServerUpdate();
    } catch {
      serverInfo = null;
    }
  }

  function onChannelChange(next) {
    channel = next;
    setChannel(next);
    // Channel change invalidates the cache; force a fresh check.
    latest = null;
    doCheck(true);
  }

  function onAutoCheckToggle() {
    autoCheck = !autoCheck;
    setAutoCheck(autoCheck);
  }

  async function doInstall() {
    if (!latest?.apkAsset) return;
    downloading = true;
    downloadPct = 0;
    installFailed = '';
    try {
      await downloadAndInstallApk(latest, pct => { downloadPct = pct; });
      showSuccess($_('updates.install_starting'));
    } catch (e) {
      installFailed = e?.message || String(e);
      showError($_('updates.install_failed'));
    } finally {
      downloading = false;
    }
  }

  function doSkip() {
    if (!latest?.version) return;
    skipVersion(latest.version);
    latest = null;
  }

  async function copyDockerCommand() {
    const cmd = 'docker-compose pull && docker-compose up -d';
    try {
      await navigator.clipboard.writeText(cmd);
      showSuccess($_('updates.server.copied'));
    } catch {
      showError($_('updates.server.copy_failed'));
    }
  }
</script>

<div class="card settings-card">
  <!-- ── Client update ─────────────────────────────────────────────── -->
  <div class="setting-row">
    <div>
      <span class="setting-label">{$_('updates.current_version')}</span>
      <span class="setting-desc">{APP_VERSION}</span>
    </div>
  </div>

  {#if showApkPanel}
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('updates.channel.label')}</span>
        <span class="setting-desc">{$_('updates.channel.help')}</span>
      </div>
      <div class="channel-picker">
        <label class="channel-opt">
          <input type="radio" name="update-channel" value="stable"
                 checked={channel === 'stable'} on:change={() => onChannelChange('stable')} />
          <span>{$_('updates.channel.stable')}</span>
        </label>
        <label class="channel-opt">
          <input type="radio" name="update-channel" value="dev"
                 checked={channel === 'dev'} on:change={() => onChannelChange('dev')} />
          <span>{$_('updates.channel.dev')}</span>
        </label>
      </div>
    </div>
  {/if}

  <div class="setting-divider"></div>
  <div class="setting-row">
    <div>
      <span class="setting-label">{$_('updates.auto_check')}</span>
      <span class="setting-desc">{$_('updates.auto_check_desc')}</span>
    </div>
    <input type="checkbox" class="toggle-cb" checked={autoCheck} on:change={onAutoCheckToggle} />
  </div>

  <div class="setting-divider"></div>
  <div class="setting-row">
    <div>
      <span class="setting-label">{$_('updates.last_checked')}</span>
      <span class="setting-desc">
        {lastChecked ? formatAgo(lastChecked) : $_('updates.last_checked_never')}
      </span>
    </div>
    <button class="btn secondary" on:click={() => doCheck(true)} disabled={checking}>
      {checking ? $_('updates.checking') : $_('updates.check_now')}
    </button>
  </div>

  {#if error}
    <div class="update-error">{error}</div>
  {/if}

  <!-- ── APK update available (Android only) ──────────────────────── -->
  {#if showApkPanel && available}
    <div class="setting-divider"></div>
    <div class="update-available">
      <div class="update-headline">
        <span class="material-symbols-rounded" aria-hidden="true">system_update</span>
        <span>{$_('updates.available_headline', { values: { version: latest.version } })}</span>
      </div>
      {#if latest.publishedAt}
        <div class="update-when">{$_('updates.released', { values: { when: formatAgo(latest.publishedAt) } })}</div>
      {/if}

      {#if latest.notes}
        <details class="update-notes">
          <summary>{$_('updates.release_notes_heading')}</summary>
          <pre>{latest.notes}</pre>
        </details>
      {/if}

      {#if latest.notesUrl}
        <a class="update-link" href={latest.notesUrl} target="_blank" rel="noopener">
          {$_('updates.view_on_github')}
        </a>
      {/if}

      {#if downloading}
        <div class="dl-progress">
          <div class="dl-bar"><div class="dl-fill" style="width:{downloadPct}%"></div></div>
          <div class="dl-pct">{$_('updates.downloading', { values: { percent: downloadPct } })}</div>
        </div>
      {:else if latest.apkAsset}
        <div class="update-actions">
          <button class="btn primary" on:click={doInstall}>{$_('updates.download_install')}</button>
          <button class="btn secondary" on:click={doSkip}>{$_('updates.skip_this_version')}</button>
        </div>
      {:else}
        <div class="update-note">{$_('updates.no_apk_asset')}</div>
      {/if}

      {#if installFailed}
        <div class="update-error">{installFailed}</div>
      {/if}
    </div>
  {:else if showApkPanel && latest && !available}
    <div class="setting-divider"></div>
    <div class="update-uptodate">
      <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
      {$_('updates.up_to_date')}
    </div>
  {/if}
</div>

<!-- ── Server update (PWA admin only) ───────────────────────────────── -->
{#if showServerPanel && serverInfo}
  <div class="card settings-card server-update-card">
    <div class="setting-row">
      <div>
        <span class="setting-label">{$_('updates.server.heading')}</span>
        <span class="setting-desc">
          {$_('updates.server.versions', { values: { current: serverInfo.current, latest: serverInfo.latest } })}
        </span>
      </div>
      {#if serverInfo.available}
        <span class="badge badge-warn">{$_('updates.server.available_chip')}</span>
      {:else}
        <span class="badge badge-ok">{$_('updates.up_to_date')}</span>
      {/if}
    </div>

    {#if serverInfo.available}
      <div class="setting-divider"></div>
      <div class="server-instructions">
        <div class="setting-desc">{$_('updates.server.instructions')}</div>
        <pre class="server-cmd">docker-compose pull && docker-compose up -d</pre>
        <div class="update-actions">
          <button class="btn secondary" on:click={copyDockerCommand}>
            {$_('updates.server.copy_command')}
          </button>
          {#if serverInfo.notes_url}
            <a class="btn secondary" href={serverInfo.notes_url} target="_blank" rel="noopener">
              {$_('updates.server.view_notes')}
            </a>
          {/if}
        </div>
        <div class="setting-desc channel-note">
          {$_('updates.server.channel_note')}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .channel-picker { display: flex; gap: 12px; }
  .channel-opt   { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
  .update-error  { color: var(--danger, #d32f2f); font-size: 13px; padding: 10px 12px; }
  .update-available, .update-uptodate {
    padding: 14px 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .update-uptodate {
    flex-direction: row; align-items: center; gap: 8px; color: var(--success, #2e7d32);
  }
  .update-headline {
    display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px;
  }
  .update-when { font-size: 12px; color: var(--text-2); }
  .update-notes summary { cursor: pointer; font-size: 13px; color: var(--accent); }
  .update-notes pre {
    white-space: pre-wrap; word-wrap: break-word;
    font-size: 12px; padding: 10px; margin-top: 6px;
    background: var(--surface-2); border-radius: 8px;
    max-height: 240px; overflow: auto;
  }
  .update-link, .update-actions a {
    display: inline-block; color: var(--accent); font-size: 13px;
    text-decoration: none;
  }
  .update-link:hover { text-decoration: underline; }
  .update-actions {
    display: flex; gap: 10px; flex-wrap: wrap;
  }
  .update-note { font-size: 13px; color: var(--text-2); font-style: italic; }
  .dl-progress { display: flex; flex-direction: column; gap: 6px; }
  .dl-bar {
    height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden;
  }
  .dl-fill {
    height: 100%; background: var(--accent); transition: width 200ms linear;
  }
  .dl-pct { font-size: 12px; color: var(--text-2); }

  .server-update-card { margin-top: 12px; }
  .server-instructions { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .server-cmd {
    background: var(--surface-2); padding: 10px 12px; border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    white-space: pre-wrap; word-break: break-all; margin: 0;
  }
  .channel-note { font-size: 12px; font-style: italic; margin-top: 4px; }
  .badge {
    display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
  }
  .badge-warn { background: color-mix(in srgb, var(--warning, #f57c00) 15%, transparent); color: var(--warning, #f57c00); }
  .badge-ok   { background: color-mix(in srgb, var(--success, #2e7d32) 15%, transparent); color: var(--success, #2e7d32); }
</style>
