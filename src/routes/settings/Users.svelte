<script>
  import { onMount } from 'svelte';
  import SettingsUserManagement from '../../components/settings/SettingsUserManagement.svelte';
  import { userMgmtActive } from '../../stores/auth.js';

  let userMgmtRef;
  onMount(() => {
    Promise.resolve().then(() => {
      if ($userMgmtActive) userMgmtRef?.loadData();
    });
  });
</script>

<div class="section-body">
  <SettingsUserManagement bind:this={userMgmtRef} />
</div>
