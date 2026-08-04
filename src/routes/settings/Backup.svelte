<script>
  import { onMount } from 'svelte';
  import SettingsBackup from '../../components/settings/SettingsBackup.svelte';
  import { currentUser } from '../../stores/auth.js';
  import { isNative, getServerUrl } from '../../lib/platform.js';

  let backupRef;
  // Native-standalone = Capacitor on-device with no linked server.
  // Same rule the parent Settings.svelte used to derive this.
  $: isNativeLocal = isNative && !getServerUrl();

  // Lazy-load on mount — sub-page mount replaces the old accordion
  // click. Same three loads the parent's reactive block did:
  //   loadFullBackups (server-side backup schedule) — admin + linked-server only
  //   loadSchedule                                  — admin + linked-server only
  //   loadLocalBackups                              — native-standalone only
  onMount(() => {
    // Wait a tick so bind:this resolves before we call into the ref.
    Promise.resolve().then(() => {
      if ($currentUser?.role === 'admin' && !isNativeLocal) {
        backupRef?.loadFullBackups();
        backupRef?.loadSchedule();
      }
      if (isNativeLocal) backupRef?.loadLocalBackups();
    });
  });
</script>

<div class="section-body">
  <SettingsBackup bind:this={backupRef} />
</div>
