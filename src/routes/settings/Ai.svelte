<script>
  import SettingsTrace from '../../components/settings/SettingsTrace.svelte';
  import { envLocks } from '../../stores/settings.js';
</script>

<SettingsTrace envLocks={$envLocks} />
