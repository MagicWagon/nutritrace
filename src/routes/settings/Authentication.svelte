<script>
  import { onMount } from 'svelte';
  import SettingsAuth from '../../components/settings/SettingsAuth.svelte';
  import { currentUser, userMgmtActive } from '../../stores/auth.js';

  let authRef;
  onMount(() => {
    Promise.resolve().then(() => {
      if ($userMgmtActive && $currentUser?.role === 'admin') authRef?.loadData();
    });
  });
</script>

<div class="section-body">
  <SettingsAuth bind:this={authRef} />
</div>
