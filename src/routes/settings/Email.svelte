<script>
  import SettingsEmail from '../../components/settings/SettingsEmail.svelte';
  import { envLocks } from '../../stores/settings.js';
</script>

<div class="section-body">
  <SettingsEmail envLocks={{ smtp: $envLocks.smtp }} />
</div>
