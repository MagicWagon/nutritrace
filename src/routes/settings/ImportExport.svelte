<script>
  import SettingsImportExport from '../../components/settings/SettingsImportExport.svelte';
  import SettingsNutritionImport from '../../components/settings/SettingsNutritionImport.svelte';
  import { isNative, getServerUrl } from '../../lib/platform.js';

  // Nutrition-import is server-backed only — hidden in native-standalone.
  $: isNativeLocal = isNative && !getServerUrl();
</script>

<div class="section-body">
  <SettingsImportExport />
  {#if !isNativeLocal}
    <SettingsNutritionImport />
  {/if}
</div>
