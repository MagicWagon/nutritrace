<script>
  import SettingsApiTokens from '../../components/settings/SettingsApiTokens.svelte';
</script>

<!-- Passing expanded=true so the child eagerly loads on sub-page mount
     (the same signal the accordion used to fire when the drawer opened). -->
<SettingsApiTokens expanded={true} />
