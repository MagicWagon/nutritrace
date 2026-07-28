<script>
  /**
   * SettingsUpdates — in-app update UX. Layout modeled on Fathom's
   * lib/screens/updates_screen.dart so the mental model transfers.
   *
   * Platforms:
   *   Android APK  : channel picks which GH release to check + download
   *                  (Stable = /releases/latest, Beta = /releases/tags/dev-latest).
   *   PWA          : channel picks which GH release the server-update
   *                  banner compares against (self-hosters on `:dev`
   *                  Docker tag want Beta so they see when a newer
   *                  dev-latest is out; users on `:latest` want Stable).
   *                  Client-bundle updates come via the service worker
   *                  independent of this panel.
   *
   * Title casing per feedback_title_case: labels/buttons/headings use
   * Chicago title case. Body prose stays sentence case.
   */
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Toggle from './Toggle.svelte';
  import { APP_VERSION } from '../../lib/version.js';
  import { isNative } from '../../lib/platform.js';
  import { currentUser } from '../../stores/auth.js';
  import { showSuccess, showError } from '../../stores/toast.js';
  import {
    checkForUpdate, isUpdateAvailable, downloadAndInstallApk,
    getChannel, setChannel, getAutoCheck, setAutoCheck,
    getLastChecked, formatAgo, checkServerUpdate,
    skipVersion, getUpdateCacheInfo, clearUpdateCache, formatBytes,
  } from '../../lib/updates.js';

  let channel     = _normalizeChannel(getChannel());
  let cacheInfo   = null;         // { files, totalBytes } — populated onMount on native only
  let clearing    = false;
  // Channel values are internally 'stable' | 'dev'. Older stored
  // values might be 'beta' (from the pre-rename UI); normalize on
  // load so the radio + backend queries stay consistent.
  let autoCheck   = getAutoCheck();
  let checking    = false;
  let latest      = null;
  let serverInfo  = null;
  let lastChecked = getLastChecked();
  let error       = '';
  let downloading = false;
  let downloadPct = 0;
  let installFailed = '';

  $: isAdmin        = $currentUser?.role === 'admin';
  $: available      = latest && isUpdateAvailable(latest);
  $: showApkPanel   = isNative;
  $: showServerPanel= !isNative && isAdmin;

  function _normalizeChannel(v) {
    if (v === 'beta') { setChannel('dev'); return 'dev'; }
    return v === 'dev' ? 'dev' : 'stable';
  }

  onMount(async () => {
    if (autoCheck) {
      await Promise.all([
        isNative ? doCheck(false) : Promise.resolve(),
        !isNative && isAdmin ? doServerCheck() : Promise.resolve(),
      ]);
    }
    if (isNative) await refreshCacheInfo();
  });

  async function refreshCacheInfo() {
    cacheInfo = await getUpdateCacheInfo();
  }

  async function doClearCache() {
    clearing = true;
    try {
      await clearUpdateCache();
      await refreshCacheInfo();
      showSuccess($_('updates.storage.cleared'));
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      clearing = false;
    }
  }

  async function doCheck(force = true) {
    checking = true;
    error = '';
    try {
      if (isNative) {
        latest = await checkForUpdate({ force });
        lastChecked = getLastChecked();
        if (!latest) error = $_('updates.check_failed');
      } else if (isAdmin) {
        await doServerCheck({ force });
        lastChecked = new Date();
      }
    } finally {
      checking = false;
    }
  }

  async function doServerCheck({ force = false } = {}) {
    try {
      serverInfo = await checkServerUpdate({ force });
    } catch { serverInfo = null; }
  }

  function onChannelChange(next) {
    channel = next;
    setChannel(next);
    latest = null;
    serverInfo = null;
    doCheck(true);
  }

  function onAutoCheckToggle(e) {
    autoCheck = e.detail;
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
      await refreshCacheInfo();
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

<!-- ── Update settings card ────────────────────────────────────────── -->
<div class="card settings-card">
  <div class="body">
    <div class="row">
      <div class="row-label">
        <span class="material-symbols-rounded row-icon" aria-hidden="true">info</span>
        <div class="label-main">{$_('updates.current_version')}</div>
      </div>
      <div class="row-value version-chip">{APP_VERSION}</div>
    </div>

    <div class="divider"></div>
    <div class="channel-block">
      <div class="channel-header">
        <div class="label-main">{$_('updates.channel.label')}</div>
        <div class="label-desc">{$_('updates.channel.help')}</div>
      </div>
      <div class="channel-picker">
        <label class="channel-opt" class:selected={channel === 'stable'}>
          <input type="radio" name="update-channel" value="stable"
                 checked={channel === 'stable'} on:change={() => onChannelChange('stable')} />
          <span class="material-symbols-rounded" style="font-size:16px">verified</span>
          {$_('updates.channel.stable')}
        </label>
        <label class="channel-opt" class:selected={channel === 'dev'}>
          <input type="radio" name="update-channel" value="dev"
                 checked={channel === 'dev'} on:change={() => onChannelChange('dev')} />
          <span class="material-symbols-rounded" style="font-size:16px">science</span>
          {$_('updates.channel.dev')}
        </label>
      </div>
    </div>

    <div class="divider"></div>
    <div class="row">
      <div class="row-label">
        <div class="label-main">{$_('updates.auto_check')}</div>
        <div class="label-desc">{$_('updates.auto_check_desc')}</div>
      </div>
      <div class="row-value">
        <Toggle checked={autoCheck} on:change={onAutoCheckToggle} />
      </div>
    </div>

    <button class="btn-check" on:click={() => doCheck(true)} disabled={checking}>
      {#if checking}
        <span class="material-symbols-rounded spin">progress_activity</span>
        {$_('updates.checking')}
      {:else}
        <span class="material-symbols-rounded">refresh</span>
        {$_('updates.check_now')}
      {/if}
    </button>

    <div class="last-checked">
      {$_('updates.last_checked')}:
      <strong>{lastChecked ? formatAgo(lastChecked) : $_('updates.last_checked_never')}</strong>
    </div>

    {#if error}
      <div class="alert alert-error">
        <span class="material-symbols-rounded" style="font-size:18px">error</span>
        {error}
      </div>
    {/if}
  </div>

  <!-- APK update available (Android only) -->
  {#if showApkPanel && available}
    <div class="update-avail-card">
      <div class="update-avail-head">
        <span class="material-symbols-rounded" style="font-size:22px">system_update</span>
        <div class="update-avail-headings">
          <div class="update-avail-title">
            {$_('updates.available_headline', { values: { version: latest.version } })}
          </div>
          {#if latest.publishedAt}
            <div class="update-avail-sub">
              {$_('updates.released', { values: { when: formatAgo(latest.publishedAt) } })}
            </div>
          {/if}
        </div>
      </div>

      {#if latest.notes}
        <details class="update-notes" open>
          <summary>{$_('updates.release_notes_heading')}</summary>
          <pre>{latest.notes}</pre>
        </details>
      {/if}

      {#if latest.notesUrl}
        <a class="update-link" href={latest.notesUrl} target="_blank" rel="noopener">
          <span class="material-symbols-rounded" style="font-size:14px">open_in_new</span>
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
          <button class="btn btn-primary" on:click={doInstall}>
            <span class="material-symbols-rounded" style="font-size:16px">download</span>
            {$_('updates.download_install')}
          </button>
          <button class="btn btn-secondary" on:click={doSkip}>{$_('updates.skip_this_version')}</button>
        </div>
      {:else}
        <div class="note">{$_('updates.no_apk_asset')}</div>
      {/if}

      {#if installFailed}
        <div class="alert alert-error">
          <span class="material-symbols-rounded" style="font-size:18px">error</span>
          {installFailed}
        </div>
      {/if}
    </div>
  {:else if showApkPanel && latest && !available}
    <div class="uptodate-tag">
      <span class="material-symbols-rounded" style="font-size:18px">check_circle</span>
      {$_('updates.up_to_date')}
    </div>
  {/if}

  <!-- Storage: what's cached under Directory.Data/updates/ (Android only) -->
  {#if showApkPanel && cacheInfo}
    <div class="divider" style="margin: 0 16px"></div>
    <div class="storage-block">
      <div class="storage-header">
        <div class="storage-title">
          <span class="material-symbols-rounded" style="font-size:18px">sd_storage</span>
          {$_('updates.storage.heading')}
        </div>
        <div class="storage-total">{formatBytes(cacheInfo.totalBytes)}</div>
      </div>

      {#if cacheInfo.files.length === 0}
        <div class="storage-empty">{$_('updates.storage.empty')}</div>
      {:else}
        <ul class="storage-list">
          {#each cacheInfo.files as f (f.name)}
            <li class="storage-item">
              <span class="storage-name" title={f.name}>{f.name}</span>
              <span class="storage-size">{formatBytes(f.size)}</span>
            </li>
          {/each}
        </ul>
        <button class="btn btn-secondary" on:click={doClearCache} disabled={clearing}>
          <span class="material-symbols-rounded" style="font-size:16px">delete_sweep</span>
          {clearing ? $_('updates.storage.clearing') : $_('updates.storage.clear_now')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<!-- ── Server update card (PWA admin only) ─────────────────────────── -->
{#if showServerPanel && serverInfo}
  <div class="card settings-card server-card">
    <div class="body">
      <div class="row">
        <div class="row-label">
          <span class="material-symbols-rounded row-icon" aria-hidden="true">dns</span>
          <div class="label-main">{$_('updates.server.heading')}</div>
        </div>
        <div class="row-value">
          {#if serverInfo.available}
            <span class="badge badge-warn">{$_('updates.server.available_chip')}</span>
          {:else}
            <span class="badge badge-ok">
              <span class="material-symbols-rounded" style="font-size:14px">check_circle</span>
              {$_('updates.up_to_date')}
            </span>
          {/if}
        </div>
      </div>
      <div class="server-versions">
        {$_('updates.server.versions', { values: { current: serverInfo.current, latest: serverInfo.latest } })}
      </div>

      {#if serverInfo.available}
        <div class="divider"></div>
        <div class="server-instructions">
          {#if serverInfo.published_at}
            <div class="server-when">
              {$_('updates.released', { values: { when: formatAgo(serverInfo.published_at) } })}
            </div>
          {/if}
          {#if serverInfo.notes}
            <details class="update-notes" open>
              <summary>{$_('updates.release_notes_heading')}</summary>
              <pre>{serverInfo.notes}</pre>
            </details>
          {/if}
          {#if serverInfo.notes_url}
            <a class="update-link" href={serverInfo.notes_url} target="_blank" rel="noopener">
              <span class="material-symbols-rounded" style="font-size:14px">open_in_new</span>
              {$_('updates.view_on_github')}
            </a>
          {/if}

          <div class="label-desc" style="margin-top:8px">{$_('updates.server.instructions')}</div>
          <pre class="server-cmd">docker-compose pull && docker-compose up -d</pre>
          <button class="btn btn-secondary" style="align-self:flex-start" on:click={copyDockerCommand}>
            <span class="material-symbols-rounded" style="font-size:16px">content_copy</span>
            {$_('updates.server.copy_command')}
          </button>
          <div class="channel-note">
            <span class="material-symbols-rounded" style="font-size:14px">info</span>
            {$_('updates.server.channel_note')}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .body { padding: 16px; display: flex; flex-direction: column; gap: 4px; }

  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 10px 0;
  }
  .row-label {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 10px;
  }
  .row-icon { color: var(--accent); font-size: 20px; flex-shrink: 0; }
  .label-main { font-size: 14px; font-weight: 600; color: var(--text-1); }
  .label-desc { font-size: 12px; color: var(--text-2); line-height: 1.35; }
  .row-value { flex-shrink: 0; }
  .divider {
    height: 1px; background: var(--border, rgba(255,255,255,0.08));
    margin: 4px 0;
  }

  .version-chip {
    font-size: 13px; font-weight: 600;
    padding: 4px 10px; border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .channel-block {
    display: flex; flex-direction: column; gap: 10px;
    padding: 10px 0;
  }
  .channel-header {
    display: flex; flex-direction: column; gap: 2px;
  }
  .channel-picker {
    display: flex; gap: 8px;
    background: var(--surface-2); border-radius: 10px;
    padding: 4px;
  }
  .channel-opt {
    flex: 1;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    color: var(--text-2);
    font-size: 13px; font-weight: 600;
    transition: all 120ms ease;
    user-select: none;
  }
  .channel-opt input { display: none; }
  .channel-opt.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }
  .channel-opt:hover:not(.selected) { color: var(--text-1); }

  .btn-check {
    width: 100%;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 16px; margin-top: 12px;
    border-radius: 10px; border: none; cursor: pointer;
    background: var(--accent); color: white;
    font-size: 14px; font-weight: 600;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .btn-check:not(:disabled):hover { opacity: 0.92; }
  .btn-check:not(:disabled):active { transform: scale(0.98); }
  .btn-check:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-check .material-symbols-rounded { font-size: 18px; }

  .last-checked {
    text-align: center;
    font-size: 12px; color: var(--text-2);
    margin-top: 8px;
  }
  .last-checked strong { color: var(--text-1); font-weight: 600; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
  }

  .alert {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-radius: 8px;
    margin: 8px 0 0;
    font-size: 13px;
  }
  .alert-error {
    background: color-mix(in srgb, var(--danger, #d32f2f) 10%, transparent);
    color: var(--danger, #d32f2f);
  }

  .update-avail-card {
    margin: 0 16px 16px;
    padding: 16px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    display: flex; flex-direction: column; gap: 12px;
  }
  .update-avail-head {
    display: flex; align-items: flex-start; gap: 10px;
    color: var(--accent);
  }
  .update-avail-headings { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .update-avail-title { font-size: 15px; font-weight: 700; }
  .update-avail-sub { font-size: 12px; color: var(--text-2); font-weight: 500; }

  .update-notes summary {
    cursor: pointer; font-size: 13px; color: var(--accent); font-weight: 600;
    padding: 6px 0;
  }
  .update-notes pre {
    white-space: pre-wrap; word-wrap: break-word;
    font-size: 12px; padding: 12px; margin-top: 6px;
    background: var(--surface-1); border-radius: 8px;
    max-height: 260px; overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text-1);
  }

  .update-link {
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--accent); font-size: 13px; text-decoration: none; font-weight: 500;
  }
  .update-link:hover { text-decoration: underline; }

  .update-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .note { font-size: 13px; color: var(--text-2); font-style: italic; }

  .dl-progress { display: flex; flex-direction: column; gap: 6px; }
  .dl-bar {
    height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden;
  }
  .dl-fill {
    height: 100%; background: var(--accent);
    transition: width 200ms linear;
  }
  .dl-pct { font-size: 12px; color: var(--text-2); font-weight: 500; }

  .storage-block {
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .storage-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
  }
  .storage-title {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 600; color: var(--text-1);
  }
  .storage-total {
    font-size: 13px; font-weight: 600; color: var(--text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .storage-empty {
    font-size: 12px; color: var(--text-2); font-style: italic;
  }
  .storage-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 4px;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .storage-item {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px;
    font-size: 12px;
  }
  .storage-name {
    flex: 1; min-width: 0;
    color: var(--text-1);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .storage-size {
    flex-shrink: 0;
    color: var(--text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .uptodate-tag {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    margin: 0 16px 16px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--success, #2e7d32) 10%, transparent);
    color: var(--success, #2e7d32);
    font-size: 13px; font-weight: 600;
    width: fit-content;
  }

  .server-card { margin-top: 12px; }
  .server-versions {
    padding: 0 0 10px 30px;
    font-size: 12px; color: var(--text-2);
  }
  .server-instructions { padding: 12px 0 4px; display: flex; flex-direction: column; gap: 10px; }
  .server-when { font-size: 12px; color: var(--text-2); font-weight: 500; }
  .server-cmd {
    background: var(--surface-2); padding: 12px 14px; border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    white-space: pre-wrap; word-break: break-all; margin: 0;
    color: var(--text-1);
    border: 1px solid var(--border, rgba(255,255,255,0.06));
  }
  .channel-note {
    display: flex; align-items: flex-start; gap: 6px;
    font-size: 12px; font-style: italic; color: var(--text-2);
    line-height: 1.4;
  }

  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .badge-warn {
    background: color-mix(in srgb, var(--warning, #f57c00) 15%, transparent);
    color: var(--warning, #f57c00);
  }
  .badge-ok {
    background: color-mix(in srgb, var(--success, #2e7d32) 15%, transparent);
    color: var(--success, #2e7d32);
  }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  @media (max-width: 520px) {
    .row { flex-wrap: wrap; }
    .row-value { width: 100%; }
  }
</style>
