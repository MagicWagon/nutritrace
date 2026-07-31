<script>
  import { onMount } from 'svelte';
  import SettingsWellness from '../../components/settings/SettingsWellness.svelte';

  let wellnessRef;
  onMount(() => {
    Promise.resolve().then(() => wellnessRef?.loadWellnessConfig());
  });
</script>

<SettingsWellness bind:this={wellnessRef} />
