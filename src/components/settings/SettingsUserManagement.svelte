<script>
  import { slide } from 'svelte/transition';
  import Toggle from './Toggle.svelte';
  import { showSuccess, showError } from '../../stores/toast.js';
  import { DB } from '../../lib/db.js';
  import { NtApi } from '../../lib/api.js';
  import { currentUser, userMgmtActive, loadAuthState } from '../../stores/auth.js';
  import { isNative, getServerUrl, resolveAssetUrl, apiUrl, getAuthToken, setAuthToken } from '../../lib/platform.js';
  import { push } from 'svelte-spa-router';

  // ── User Management state ────────────────────────────────────────────────────
  let umUsers        = [];
  let umLoading      = false;
  let showAddUser    = false;
  let newUsername    = '';
  let newPassword    = '';
  let newShowPass    = false;
  let newFullName    = '';
  let newRole        = 'user';
  let umError        = '';
  let showDisableUmDialog = false;

  // Enable user management from Settings
  let showEnableUm    = false;
  let enableAdminUser = '';
  let enableAdminPass = '';
  let enableShowPass = false;
  let enableAdminConf = '';
  let enableAdminName = '';
  let enableUmError   = '';
  let enableUmLoading = false;

  // Session duration (admin-only)
  let sessionHours = '720';
  let sessionSaved = false;

  // ── OIDC providers (admin) ───────────────────────────────────────────────
  let oidcProviders = [];
  let enablePasswordLogin = true;
  let oidcExpanded = false;
  let oidcEditing = null;     // null | { ...providerFields } (id present = edit; absent = create)
  let oidcTestResult = null;
  let oidcBusy = false;
  let oidcSelectedPreset = 'custom'; // dropdown state during create

  // Presets for the most common self-hosted + public OIDC providers. Each
  // preset pre-fills sensible defaults and shows an inline help line so the
  // admin doesn't have to look up issuer-URL syntax. Ordered alphabetically
  // with Custom last as the catch-all fallback.
  const PROVIDER_PRESETS = [
    {
      id: 'auth0',
      name: 'Auth0',
      icon: 'cloud',
      defaults: {
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: '',  // Auth0 typically uses namespaced claims — user fills in their own
        display_name: 'Auth0',
        logo_url: 'https://cdn.simpleicons.org/auth0/EB5424',
      },
      issuer_hint: 'https://<your-tenant>.auth0.com/',
      help: 'Auth0 adds custom claims under a namespaced URL like "https://nutritrace.app/roles" — leave the admin claim blank for now and contact your tenant admin to set up a rule that exposes role membership.',
      hides: [],
    },
    {
      id: 'authelia',
      name: 'Authelia',
      icon: 'lock',
      defaults: {
        scope: 'openid profile email groups',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: 'groups',
        display_name: 'Authelia',
        logo_url: 'https://cdn.simpleicons.org/authelia/000000',
      },
      issuer_hint: 'https://auth.example.com',
      help: 'Authelia\'s issuer URL is the root URL where Authelia is served — no path suffix.',
      hides: [],
    },
    {
      id: 'authentik',
      name: 'Authentik',
      icon: 'verified_user',
      defaults: {
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: 'groups',
        display_name: 'Authentik',
        logo_url: '/icons/sso/authentik.svg',
      },
      issuer_hint: 'https://auth.example.com/application/o/<your-app-slug>/',
      help: 'Issuer URL is the "OpenID Configuration Issuer" shown on the Provider page in Authentik. Make sure your Application uses an OAuth2/OIDC Provider and you\'ve added the redirect URI shown above to its allowed list.',
      hides: [],
    },
    {
      id: 'google',
      name: 'Google',
      icon: 'account_circle',
      defaults: {
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: '',
        admin_group_value: '',
        display_name: 'Google',
        logo_url: 'https://cdn.simpleicons.org/google/4285F4',
      },
      issuer_hint: 'https://accounts.google.com',
      help: 'Google\'s issuer URL is fixed. Group/role claims are not available with standard scopes — admin role mapping is hidden for this provider; promote Google users manually after first login.',
      hides: ['admin_group_claim', 'admin_group_value'],
    },
    {
      id: 'keycloak',
      name: 'Keycloak',
      icon: 'shield',
      defaults: {
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
        admin_group_claim: 'groups',
        display_name: 'Keycloak',
        logo_url: 'https://cdn.simpleicons.org/keycloak/4D4D4D',
      },
      issuer_hint: 'https://auth.example.com/realms/<your-realm>',
      help: 'Add a "groups" mapper to your client\'s default scope so the groups claim is included in the ID token.',
      hides: [],
    },
    {
      id: 'pocket-id',
      name: 'Pocket ID',
      icon: 'fingerprint',
      defaults: {
        scope: 'openid profile email groups',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: 'groups',
        display_name: 'Pocket ID',
        logo_url: '/icons/sso/pocket-id.svg',
      },
      issuer_hint: 'https://id.example.com',
      help: 'Pocket ID uses passkeys for primary auth — your users won\'t need a password at the IdP either. Add the redirect URI shown above to the OIDC client in Pocket ID admin.',
      hides: [],
    },
    {
      id: 'custom',
      name: 'Custom / Generic OIDC',
      icon: 'badge',
      defaults: {
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_post',
        admin_group_claim: '',
        display_name: '',
        logo_url: '',
      },
      issuer_hint: 'https://your-idp.example.com',
      help: 'Any OpenID Connect 1.0 compliant provider that supports Authorization Code Flow + PKCE + Discovery should work here.',
      hides: [],
    },
  ];

  function _getPreset(id) {
    return PROVIDER_PRESETS.find(p => p.id === id) || PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
  }

  $: oidcPreset = _getPreset(oidcSelectedPreset);

  // When the preset changes during create, re-apply its defaults to the form
  // (overwriting anything the user typed in the affected fields).
  function applyPreset() {
    if (!oidcEditing || oidcEditing.id) return; // edit mode — don't clobber existing
    const p = _getPreset(oidcSelectedPreset);
    oidcEditing = {
      ...oidcEditing,
      ...p.defaults,
      // preserve user-entered fields that aren't preset-managed
      issuer_url: oidcEditing.issuer_url,
      client_id: oidcEditing.client_id,
      client_secret: oidcEditing.client_secret,
      redirect_uris: oidcEditing.redirect_uris,
      auto_register: oidcEditing.auto_register,
      is_active: oidcEditing.is_active,
    };
  }
  $: if (oidcSelectedPreset && oidcEditing && !oidcEditing.id) applyPreset();

  function _csrfHeaders(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (isNative && getServerUrl()) {
      const t = getAuthToken();
      if (t) h['Authorization'] = `Bearer ${t}`;
    } else {
      const csrf = localStorage.getItem('nt:csrf');
      if (csrf) h['X-CSRF-Token'] = csrf;
    }
    return h;
  }

  async function loadOidc() {
    try {
      const r = await fetch(apiUrl('/api/admin/oidc/providers'), { credentials: 'include', headers: _csrfHeaders() });
      if (r.ok) {
        const data = await r.json();
        oidcProviders = data?.providers || [];
        enablePasswordLogin = data?.enable_email_password_login !== false;
      }
    } catch {}
  }

  function startCreateProvider() {
    oidcSelectedPreset = 'custom';
    const p = _getPreset('custom');
    oidcEditing = {
      issuer_url: '',
      client_id: '',
      client_secret: '',
      redirect_uris: [_defaultRedirectUri()],
      auto_link_verified_email: 1,  // safe default — silently link existing users
      auto_register_new_users:  0,  // careful default — admin invites new users
      admin_group_value: '',
      is_active: 1,
      ...p.defaults,
    };
    oidcTestResult = null;
  }

  function _defaultRedirectUri() {
    if (typeof window === 'undefined') return '';
    const basePath = window.__NT_CONFIG__?.basePath || '';
    const id = oidcEditing?.id || ':providerId';
    return `${window.location.origin}${basePath}/api/auth/oidc/callback/${id}`;
  }

  function startEditProvider(p) {
    oidcEditing = {
      ...p,
      client_secret: '',                         // never echo back
      redirect_uris: Array.isArray(p.redirect_uris) ? [...p.redirect_uris] : [],
    };
    // Detect which preset (if any) this provider matches — useful for
    // showing the right help text + hiding irrelevant fields.
    oidcSelectedPreset = _detectPreset(p);
    oidcTestResult = null;
  }

  function _detectPreset(p) {
    // Best-effort match by display_name first, then issuer_url substring.
    const dn = (p.display_name || '').toLowerCase();
    const issuer = (p.issuer_url || '').toLowerCase();
    if (dn.includes('authentik') || issuer.includes('/application/o/')) return 'authentik';
    if (dn.includes('keycloak')  || issuer.includes('/realms/'))         return 'keycloak';
    if (dn.includes('authelia'))                                          return 'authelia';
    if (dn.includes('pocket'))                                            return 'pocket-id';
    if (dn.includes('auth0')     || issuer.includes('.auth0.com'))       return 'auth0';
    if (dn.includes('google')    || issuer.includes('accounts.google'))  return 'google';
    return 'custom';
  }

  function cancelProviderEdit() {
    oidcEditing = null;
    oidcTestResult = null;
  }

  async function saveProvider() {
    if (oidcBusy) return;
    if (!oidcEditing.issuer_url?.trim() || !oidcEditing.client_id?.trim()) {
      showError('Issuer URL and Client ID are required');
      return;
    }
    if (!oidcEditing.redirect_uris?.filter(Boolean).length) {
      showError('At least one redirect URI is required');
      return;
    }
    oidcBusy = true;
    try {
      const isEdit = !!oidcEditing.id;
      const url = isEdit
        ? apiUrl(`/api/admin/oidc/providers/${oidcEditing.id}`)
        : apiUrl(`/api/admin/oidc/providers`);
      const body = { ...oidcEditing };
      // Treat empty client_secret as "leave unchanged" on edit; required on create.
      if (isEdit && !body.client_secret) delete body.client_secret;
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        credentials: 'include',
        headers: _csrfHeaders(),
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { showError(data?.error || 'Save failed'); return; }
      showSuccess(isEdit ? 'Provider updated' : 'Provider created');
      oidcEditing = null;
      await loadOidc();
    } catch (e) {
      showError('Could not reach server');
    } finally {
      oidcBusy = false;
    }
  }

  async function testProvider(id) {
    oidcBusy = true;
    oidcTestResult = null;
    try {
      const r = await fetch(apiUrl(`/api/admin/oidc/providers/${id}/test`), {
        method: 'POST', credentials: 'include', headers: _csrfHeaders(),
      });
      oidcTestResult = await r.json();
    } catch (e) {
      oidcTestResult = { ok: false, error: 'Could not reach server' };
    } finally { oidcBusy = false; }
  }

  async function deleteProvider(p) {
    if (!confirm(`Delete provider "${p.display_name || p.issuer_url}"? Linked users will lose this sign-in option.`)) return;
    oidcBusy = true;
    try {
      const r = await fetch(apiUrl(`/api/admin/oidc/providers/${p.id}`), {
        method: 'DELETE', credentials: 'include', headers: _csrfHeaders(),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showError(data?.error || 'Delete failed'); return;
      }
      showSuccess('Provider deleted');
      await loadOidc();
    } catch { showError('Could not reach server'); }
    finally { oidcBusy = false; }
  }

  async function togglePasswordLogin() {
    const next = !enablePasswordLogin;
    if (!next && !oidcProviders.some(p => p.is_active)) {
      showError('Add at least one active OIDC provider before disabling password login.');
      return;
    }
    if (!next && !confirm('Disable password login? Users without an OIDC link will not be able to sign in until you re-enable it. RECOVERY_TOKEN will still work.')) return;
    try {
      const r = await fetch(apiUrl('/api/admin/oidc/password-login'), {
        method: 'PUT', credentials: 'include', headers: _csrfHeaders(),
        body: JSON.stringify({ enabled: next }),
      });
      const data = await r.json();
      if (!r.ok) { showError(data?.error || 'Save failed'); return; }
      enablePasswordLogin = !!data.enable_email_password_login;
      showSuccess(enablePasswordLogin ? 'Password login enabled' : 'Password login disabled');
    } catch { showError('Could not reach server'); }
  }

  function addRedirectUri() {
    if (!oidcEditing) return;
    oidcEditing.redirect_uris = [...(oidcEditing.redirect_uris || []), ''];
  }
  function removeRedirectUri(i) {
    if (!oidcEditing) return;
    oidcEditing.redirect_uris = oidcEditing.redirect_uris.filter((_, idx) => idx !== i);
  }

  // Invite
  let inviteEmail  = '';
  let inviteRole   = 'user';
  let inviteLoading = false;
  let inviteResult = null; // { inviteUrl, sent }

  export async function loadData() {
    if ($userMgmtActive) {
      await loadUsers();
      if ($currentUser?.role === 'admin') {
        await loadSessionConfig();
        await loadOidc();
      }
    }
  }

  async function loadSessionConfig() {
    try {
      const res = await fetch(apiUrl('/api/app-config'), { credentials: 'include' });
      if (!res.ok) return;
      const cfg = await res.json();
      sessionHours = cfg.session_hours ?? '720';
    } catch {}
  }

  async function saveSessionHours() {
    const h = {};
    if (isNative && getServerUrl()) {
      const t = getAuthToken();
      if (t) h['Authorization'] = `Bearer ${t}`;
    } else {
      const csrf = localStorage.getItem('nt:csrf');
      if (csrf) h['X-CSRF-Token'] = csrf;
    }
    await fetch(apiUrl('/api/app-config'), {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ key: 'session_hours', value: sessionHours }),
    }).catch(() => {});
    sessionSaved = true;
    setTimeout(() => sessionSaved = false, 2000);
  }

  async function enableUserManagement() {
    enableUmError = '';
    if (!enableAdminUser.trim()) { enableUmError = 'Username is required'; return; }
    if (enableAdminPass.length < 6) { enableUmError = 'Password must be at least 6 characters'; return; }
    if (enableAdminPass !== enableAdminConf) { enableUmError = 'Passwords do not match'; return; }
    enableUmLoading = true;
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:  enableAdminUser.trim(),
          password:  enableAdminPass,
          full_name: enableAdminName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { enableUmError = data.error || 'Registration failed'; enableUmLoading = false; return; }
      localStorage.setItem('wl:userId', data.user.id);
      await loadAuthState();
      showEnableUm = false;
      enableAdminUser = ''; enableAdminPass = ''; enableAdminConf = ''; enableAdminName = '';
      await loadUsers();
      showSuccess('User management enabled');
    } catch(e) { enableUmError = 'Could not connect to server'; }
    enableUmLoading = false;
  }

  async function loadUsers() {
    try {
      umUsers = await NtApi.get('/api/auth/users');
    } catch(e) { umError = e.message; }
  }

  async function addUser() {
    umError = '';
    if (!newUsername.trim() || !newPassword.trim()) { umError = 'Username and password required'; return; }
    umLoading = true;
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, full_name: newFullName.trim() || undefined, role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { umError = data.error || 'Failed to add user'; } else {
        newUsername = ''; newPassword = ''; newFullName = ''; newRole = 'user';
        showAddUser = false;
        await loadUsers();
        showSuccess('User added');
      }
    } catch(e) { umError = e.message; }
    umLoading = false;
  }

  async function deleteUser(id) {
    try {
      await NtApi.del(`/api/auth/users/${id}`);
      await loadUsers();
      showSuccess('User deleted');
    } catch(e) { showError(e.message); }
  }

  async function disableUserManagement() {
    try {
      await NtApi.del('/api/auth/management');
      localStorage.removeItem('wl:userId');
      await loadAuthState();
      showDisableUmDialog = false;
      showSuccess('User management disabled');
      await loadUsers();
    } catch(e) { showError(e.message); }
  }

  async function logoutServer() {
    document.body.style.transition = 'opacity 0.3s';
    document.body.style.opacity = '0';
    // Tell the server to clear the auth cookie — it's httpOnly so the
    // client can't drop it directly. Without this round-trip the page
    // reload below would silently re-authenticate and leave the user in.
    try {
      const csrf = localStorage.getItem('nt:csrf');
      const headers = {};
      if (isNative && getServerUrl()) {
        const t = getAuthToken();
        if (t) headers['Authorization'] = `Bearer ${t}`;
      } else if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST', credentials: 'include', headers,
      });
    } catch {}
    localStorage.removeItem('wl:userId');
    localStorage.removeItem('nt:cachedUser');
    localStorage.removeItem('nt:csrf');
    // Keep nt:cachedUserMgmt — user-management is a server-wide flag, not
    // a per-session one, so don't flicker the post-reload boot into wizard.
    if (isNative) setAuthToken(null);
    setTimeout(() => window.location.reload(), 300);
  }

  async function createInvite() {
    inviteLoading = true;
    inviteResult  = null;
    try {
      const res  = await fetch(apiUrl('/api/auth/invite'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Failed to create invite'); return; }
      inviteResult = data;
      inviteEmail  = '';
    } catch { showError('Could not create invite'); }
    inviteLoading = false;
  }
</script>

<div class="section-body" transition:slide={{ duration: 180 }}>
  <div class="card settings-card">
    {#if $userMgmtActive}
      <!-- Current user row -->
      <button class="setting-row setting-action" on:click={() => push('/profile')}>
        <span class="material-symbols-rounded si" style="color:var(--accent)">manage_accounts</span>
        <div>
          <span class="setting-label">My Profile</span>
          <div class="setting-desc">{$currentUser?.nickname || $currentUser?.full_name || $currentUser?.username || ''}</div>
        </div>
        <span class="material-symbols-rounded text-3" style="font-size:18px">chevron_right</span>
      </button>
      <div class="setting-divider"></div>

      <!-- User list (admin only) -->
      {#if $currentUser?.role === 'admin'}
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;padding:12px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
            <span class="setting-label">Users</span>
            <button class="btn btn-secondary" style="height:30px;font-size:12px;padding:0 10px"
              on:click={() => { showAddUser = !showAddUser; umError = ''; }}>
              {showAddUser ? 'Cancel' : '+ Add User'}
            </button>
          </div>

          {#if showAddUser}
            <div class="um-add-form" transition:slide={{ duration: 160 }}>
              <div class="um-form-row">
                <input class="input" type="text" bind:value={newUsername} placeholder="Username *" autocomplete="off" />
                <div style="display:flex;gap:4px;align-items:center;flex:1">
                  {#if newShowPass}
                    <input class="input" style="flex:1" type="text" bind:value={newPassword} placeholder="Password *" autocomplete="new-password" />
                  {:else}
                    <input class="input" style="flex:1" type="password" bind:value={newPassword} placeholder="Password *" autocomplete="new-password" />
                  {/if}
                  <button class="btn-icon" on:click={() => newShowPass = !newShowPass} style="flex-shrink:0">
                    <span class="material-symbols-rounded" style="font-size:18px">{newShowPass ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>
              <div class="um-form-row">
                <input class="input" type="text" bind:value={newFullName} placeholder="Full name (optional)" />
                <select class="input" bind:value={newRole}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {#if umError}<p class="um-error">{umError}</p>{/if}
              <button class="btn btn-primary" style="width:100%" on:click={addUser} disabled={umLoading}>
                {umLoading ? 'Adding...' : 'Create User'}
              </button>
            </div>
          {/if}

          <div class="um-user-list">
            {#each umUsers as u}
              <div class="um-user-row">
                <div class="um-user-avatar">
                  {#if u.avatar_url}
                    <img src={resolveAssetUrl(u.avatar_url)} alt={u.username} />
                  {:else}
                    <span class="material-symbols-rounded">person</span>
                  {/if}
                </div>
                <div class="um-user-info">
                  <div class="um-user-name">{u.nickname || u.full_name || u.username}</div>
                  <div class="um-user-sub">@{u.username}{u.role === 'admin' ? ' · admin' : ''}</div>
                </div>
                {#if u.id !== $currentUser?.id}
                  <button class="btn btn-ghost um-del-btn" title="Delete user"
                    on:click={() => deleteUser(u.id)}>
                    <span class="material-symbols-rounded" style="font-size:18px;color:var(--danger)">person_remove</span>
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
        <div class="setting-divider"></div>

        <!-- Invite user -->
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;padding:12px 16px">
          <span class="setting-label">Invite user</span>
          <div class="um-form-row">
            <input class="input" type="email" bind:value={inviteEmail} placeholder="Email (optional)" />
            <select class="input" bind:value={inviteRole}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button class="btn btn-secondary" style="width:100%" on:click={createInvite} disabled={inviteLoading}>
            {inviteLoading ? 'Creating…' : 'Generate invite link'}
          </button>
          {#if inviteResult}
            <div class="invite-result" transition:slide={{ duration: 160 }}>
              {#if inviteResult.sent}
                <span class="material-symbols-rounded" style="color:var(--accent);font-size:18px">mark_email_read</span>
                <span style="font-size:13px">Invite sent to <strong>{inviteEmail || 'user'}</strong></span>
              {:else}
                <span style="font-size:13px;color:var(--text-2)">Share this link:</span>
                <div class="invite-link-row">
                  <input class="input" style="flex:1;font-size:12px" readonly value={inviteResult.inviteUrl} />
                  <button class="btn btn-secondary" style="height:36px;padding:0 12px;font-size:12px"
                    on:click={() => { navigator.clipboard?.writeText(inviteResult.inviteUrl); showSuccess('Copied!'); }}>
                    Copy
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- OIDC providers (admin) -->
        <div class="setting-divider"></div>
        <button class="setting-row setting-action" on:click={() => oidcExpanded = !oidcExpanded}>
          <span class="material-symbols-rounded si" style="color:var(--accent)">badge</span>
          <div style="flex:1;text-align:left">
            <span class="setting-label">OIDC providers (Single Sign-On)</span>
            <div class="setting-desc">Configure Authentik, Keycloak, Pocket ID, Auth0, Google, etc. Users sign in with their existing identity provider.</div>
          </div>
          <span class="material-symbols-rounded si">{oidcExpanded ? 'expand_less' : 'expand_more'}</span>
        </button>
        {#if oidcExpanded}
          <div class="setting-row" style="display:flex;flex-direction:column;align-items:stretch;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="text-3 text-sm">{oidcProviders.length} configured</span>
              <button class="btn btn-secondary" style="height:32px;font-size:12px;padding:0 12px" on:click={startCreateProvider}>
                + Add provider
              </button>
            </div>

            {#each oidcProviders as p (p.id)}
              <div class="oidc-row">
                {#if p.logo_url}<img src={resolveAssetUrl(p.logo_url)} alt="" class="oidc-logo" />{:else}<span class="material-symbols-rounded oidc-icon">verified_user</span>{/if}
                <div class="oidc-info">
                  <span class="oidc-name">{p.display_name || p.issuer_url}</span>
                  <span class="text-3 text-sm">{p.issuer_url} · link {p.auto_link_verified_email ? 'on' : 'off'} · register {p.auto_register_new_users ? 'on' : 'off'}{!p.is_active ? ' · disabled' : ''}</span>
                </div>
                <div class="oidc-actions">
                  <button class="btn-icon" title="Test discovery" on:click={() => testProvider(p.id)} disabled={oidcBusy}>
                    <span class="material-symbols-rounded">network_check</span>
                  </button>
                  <button class="btn-icon" title="Edit" on:click={() => startEditProvider(p)} disabled={oidcBusy}>
                    <span class="material-symbols-rounded">edit</span>
                  </button>
                  <button class="btn-icon" title="Delete" on:click={() => deleteProvider(p)} disabled={oidcBusy}>
                    <span class="material-symbols-rounded" style="color:var(--danger)">delete</span>
                  </button>
                </div>
              </div>
            {/each}

            {#if oidcTestResult}
              <div class="oidc-test-result" class:ok={oidcTestResult.ok}>
                {#if oidcTestResult.ok}
                  <strong>Discovery OK</strong>
                  <div class="text-3 text-sm">issuer: {oidcTestResult.issuer}</div>
                  <div class="text-3 text-sm">authorization_endpoint: {oidcTestResult.authorization_endpoint || '—'}</div>
                  <div class="text-3 text-sm">token_endpoint: {oidcTestResult.token_endpoint || '—'}</div>
                  <div class="text-3 text-sm">end_session_endpoint: {oidcTestResult.end_session_endpoint || '—'}</div>
                {:else}
                  <strong style="color:var(--danger)">Discovery failed</strong>
                  <div class="text-3 text-sm">{oidcTestResult.error}</div>
                {/if}
              </div>
            {/if}

            {#if oidcEditing}
              <div class="oidc-form" transition:slide={{ duration: 180 }}>
                {#if !oidcEditing.id}
                  <div class="form-group">
                    <label class="form-label">Provider type</label>
                    <div class="oidc-preset-grid">
                      {#each PROVIDER_PRESETS as preset (preset.id)}
                        <button
                          type="button"
                          class="oidc-preset-card"
                          class:selected={oidcSelectedPreset === preset.id}
                          on:click={() => oidcSelectedPreset = preset.id}
                          title={preset.name}
                        >
                          {#if preset.defaults.logo_url}
                            <img src={resolveAssetUrl(preset.defaults.logo_url)} alt="" class="oidc-preset-logo" />
                          {:else}
                            <span class="material-symbols-rounded oidc-preset-icon">{preset.icon}</span>
                          {/if}
                          <span class="oidc-preset-name">{preset.name}</span>
                        </button>
                      {/each}
                    </div>
                    {#if oidcPreset.help}
                      <div class="text-3 text-sm" style="margin-top:8px;line-height:1.4">
                        <span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle">info</span>
                        {oidcPreset.help}
                      </div>
                    {/if}
                  </div>
                {/if}
                <div class="form-group">
                  <label class="form-label">Display name</label>
                  <input class="input" bind:value={oidcEditing.display_name} placeholder={oidcPreset.defaults.display_name || 'Authentik / Pocket ID / Google'} />
                </div>
                <div class="form-group">
                  <label class="form-label">Issuer URL *</label>
                  <input class="input" bind:value={oidcEditing.issuer_url} placeholder={oidcPreset.issuer_hint} autocomplete="url" />
                </div>
                <div class="form-group">
                  <label class="form-label">Client ID *</label>
                  <input class="input" bind:value={oidcEditing.client_id} autocomplete="off" />
                </div>
                <div class="form-group">
                  <label class="form-label">Client secret {oidcEditing.id ? '(leave blank to keep existing)' : '*'}</label>
                  <input class="input" type="password" bind:value={oidcEditing.client_secret} autocomplete="off" />
                </div>
                <div class="form-group">
                  <label class="form-label">Redirect URIs *</label>
                  {#each oidcEditing.redirect_uris as uri, i}
                    <div style="display:flex;gap:6px;margin-bottom:4px">
                      <input class="input" style="flex:1" bind:value={oidcEditing.redirect_uris[i]} placeholder="https://nutritrace.app/api/auth/oidc/callback/{oidcEditing.id || ':providerId'}" />
                      {#if oidcEditing.redirect_uris.length > 1}
                        <button class="btn-icon" on:click={() => removeRedirectUri(i)} title="Remove"><span class="material-symbols-rounded">close</span></button>
                      {/if}
                    </div>
                  {/each}
                  <button class="btn btn-ghost btn-sm" type="button" on:click={addRedirectUri}>+ Add redirect URI</button>
                  <div class="text-3 text-sm" style="margin-top:4px">Must match exactly what your IdP has configured. The path is <code>/api/auth/oidc/callback/&lt;provider-id&gt;</code> under your NutriTrace base URL.</div>
                </div>
                <div class="form-group">
                  <label class="form-label">Scope</label>
                  <input class="input" bind:value={oidcEditing.scope} />
                </div>
                <div class="form-group">
                  <label class="form-label">Token endpoint auth method</label>
                  <select class="select" bind:value={oidcEditing.token_endpoint_auth_method}>
                    <option value="client_secret_post">client_secret_post (default)</option>
                    <option value="client_secret_basic">client_secret_basic</option>
                    <option value="none">none (PKCE-only public client)</option>
                  </select>
                </div>
                <div class="setting-row" style="padding:0">
                  <div>
                    <span class="setting-label">Auto-link existing users (verified email)</span>
                    <div class="setting-desc">When the IdP says <code>email_verified=true</code> and the email matches an existing NutriTrace user, link them silently on first SSO sign-in. Recommended ON for any IdP you trust to verify emails.</div>
                  </div>
                  <Toggle checked={!!oidcEditing.auto_link_verified_email} on:change={e => oidcEditing.auto_link_verified_email = e.detail ? 1 : 0} />
                </div>
                <div class="setting-row" style="padding:0">
                  <div>
                    <span class="setting-label">Auto-register new users</span>
                    <div class="setting-desc">Allow anyone with an account at this IdP to create a brand-new NutriTrace account on first sign-in. OFF = admin must invite first. Leave OFF for shared IdPs (Google, work SSO) unless you actually want blanket onboarding.</div>
                  </div>
                  <Toggle checked={!!oidcEditing.auto_register_new_users} on:change={e => oidcEditing.auto_register_new_users = e.detail ? 1 : 0} />
                </div>
                <div class="setting-row" style="padding:0">
                  <div>
                    <span class="setting-label">Provider active</span>
                    <div class="setting-desc">Inactive providers won't show on the Login page.</div>
                  </div>
                  <Toggle checked={!!oidcEditing.is_active} on:change={e => oidcEditing.is_active = e.detail ? 1 : 0} />
                </div>
                {#if !oidcPreset.hides?.includes('admin_group_claim')}
                  <div class="form-group">
                    <label class="form-label">Admin group claim (optional)</label>
                    <input class="input" bind:value={oidcEditing.admin_group_claim} placeholder="groups" />
                    <div class="text-3 text-sm">Name of the claim that lists user groups. Common: <code>groups</code>.</div>
                  </div>
                {/if}
                {#if !oidcPreset.hides?.includes('admin_group_value')}
                  <div class="form-group">
                    <label class="form-label">Admin group value (optional)</label>
                    <input class="input" bind:value={oidcEditing.admin_group_value} placeholder="NutriTraceAdmins" />
                    <div class="text-3 text-sm">If a user's groups claim contains this value, they're set to admin on each login.</div>
                  </div>
                {/if}
                <div class="form-group">
                  <label class="form-label">Logo URL (optional)</label>
                  <input class="input" bind:value={oidcEditing.logo_url} placeholder="https://…/authentik.png" />
                </div>
                <div style="display:flex;gap:8px;margin-top:8px">
                  <button class="btn btn-ghost" style="flex:1" on:click={cancelProviderEdit}>Cancel</button>
                  <button class="btn btn-primary" style="flex:1" on:click={saveProvider} disabled={oidcBusy}>
                    {oidcBusy ? 'Saving…' : (oidcEditing.id ? 'Save changes' : 'Create provider')}
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <div class="setting-row">
            <div>
              <span class="setting-label">Allow password login</span>
              <div class="setting-desc">When off, users sign in only via OIDC. Recovery still works via the <code>RECOVERY_TOKEN</code> env var.</div>
            </div>
            <Toggle checked={enablePasswordLogin} on:change={togglePasswordLogin} />
          </div>
        {/if}

        <div class="setting-divider"></div>
        <div class="setting-row">
          <div>
            <span class="setting-label">Session duration</span>
            <div class="setting-desc">How long users stay signed in. Applies to new logins.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="select-wrap" style="width:130px">
              <select class="select sel-sm" bind:value={sessionHours}>
                <option value="0">Never expires</option>
                <option value="8">8 hours</option>
                <option value="24">1 day</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
                <option value="2160">90 days</option>
                <option value="8760">1 year</option>
              </select>
            </div>
            <button class="btn btn-secondary" style="height:32px;font-size:12px;padding:0 12px;white-space:nowrap" on:click={saveSessionHours}>
              {#if sessionSaved}<span class="material-symbols-rounded" style="font-size:14px">check</span>{:else}Save{/if}
            </button>
          </div>
        </div>

        <div class="setting-divider"></div>
        <button class="setting-row setting-action danger" on:click={() => showDisableUmDialog = true}>
          <span class="material-symbols-rounded si" style="color:var(--danger)">no_accounts</span>
          <div>
            <span class="setting-label" style="color:var(--danger)">Disable user management</span>
            <div class="setting-desc">Removes all user accounts and returns to single-user mode</div>
          </div>
        </button>
      {/if}

      <div class="setting-divider"></div>
      <button class="setting-row setting-action" on:click={logoutServer}>
        <span class="material-symbols-rounded si" style="color:var(--text-3)">logout</span>
        <span class="setting-label">Sign out</span>
      </button>
    {:else}
      <button class="setting-row setting-action" on:click={() => { showEnableUm = !showEnableUm; enableUmError = ''; }}>
        <span class="material-symbols-rounded si" style="color:var(--accent)">group_add</span>
        <div>
          <span class="setting-label">Enable user management</span>
          <div class="setting-desc">Add multiple user accounts with separate data &amp; settings</div>
        </div>
        <span class="material-symbols-rounded text-3" style="font-size:18px">{showEnableUm ? 'expand_less' : 'expand_more'}</span>
      </button>

      {#if showEnableUm}
        <div class="section-body" style="padding:0 16px 16px" transition:slide={{ duration: 160 }}>
          <p class="um-section-label" style="margin-bottom:8px">Create admin account</p>
          <div class="um-add-form">
            <div class="um-form-row">
              <input class="input" type="text" bind:value={enableAdminUser} placeholder="Username *" autocomplete="username" />
              <input class="input" type="text" bind:value={enableAdminName} placeholder="Full name (optional)" />
            </div>
            <div class="um-form-row">
              <div style="display:flex;gap:4px;align-items:center;flex:1">
                {#if enableShowPass}
                  <input class="input" style="flex:1" type="text" bind:value={enableAdminPass} placeholder="Password *" autocomplete="new-password" />
                {:else}
                  <input class="input" style="flex:1" type="password" bind:value={enableAdminPass} placeholder="Password *" autocomplete="new-password" />
                {/if}
                <button class="btn-icon" on:click={() => enableShowPass = !enableShowPass} style="flex-shrink:0">
                  <span class="material-symbols-rounded" style="font-size:18px">{enableShowPass ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              {#if enableShowPass}
                <input class="input" type="text" bind:value={enableAdminConf} placeholder="Confirm *" autocomplete="new-password" />
              {:else}
                <input class="input" type="password" bind:value={enableAdminConf} placeholder="Confirm *" autocomplete="new-password" />
              {/if}
            </div>
            {#if enableUmError}<p class="um-error">{enableUmError}</p>{/if}
            <button class="btn btn-primary" style="width:100%" on:click={enableUserManagement} disabled={enableUmLoading}>
              {enableUmLoading ? 'Enabling...' : 'Enable & Create Admin'}
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Disable user management dialog -->
{#if showDisableUmDialog}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dialog-overlay" on:click|self={() => showDisableUmDialog = false}>
    <div class="dialog-box">
      <h3 class="dialog-title">Disable user management</h3>
      <p class="dialog-msg">This will remove all user accounts and their data cannot be recovered. The app will return to single-user mode.</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" on:click={() => showDisableUmDialog = false}>Cancel</button>
        <button class="btn btn-danger" on:click={disableUserManagement}>Disable &amp; delete all users</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Mirror Settings.svelte scoped styles */
  .section-body { padding: 12px var(--page-px); display: flex; flex-direction: column; gap: 10px; }
  .settings-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    min-height: 50px;
  }
  .setting-label { font-size: 14px; font-weight: 500; flex: 1; }
  .setting-desc  { font-size: 12px; color: var(--text-3); margin-top: 2px; font-weight: 400; }
  .setting-divider { height: 1px; background: var(--border); margin: 0 16px; }
  .sel-sm { height: 36px; font-size: 13px; }

  .setting-action {
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-1);
  }
  .setting-action:hover { background: var(--surface-2); }
  .setting-action.danger:hover { background: rgba(239,68,68,0.06); }

  /* User management styles */
  .um-add-form { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .um-form-row { display: flex; gap: 8px; }
  .um-user-list { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .um-user-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .um-user-avatar {
    width: 36px; height: 36px;
    border-radius: 50%;
    background: var(--surface-3);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    font-size: 20px; color: var(--text-3);
  }
  .um-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .um-user-info { flex: 1; min-width: 0; }
  .um-user-name { font-size: 14px; font-weight: 500; color: var(--text-1); }
  .um-user-sub  { font-size: 12px; color: var(--text-3); }
  .um-del-btn   { padding: 4px 8px; }
  .um-error     { color: var(--danger); font-size: 13px; margin: 0; }
  .um-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }

  .invite-result {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 10px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
  }
  .invite-link-row { display: flex; gap: 8px; }

  /* Inline dialog (for disable user management) */
  .dialog-overlay {
    position: fixed; inset: 0; z-index: 500;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .dialog-box {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 24px;
    max-width: 380px;
    width: 100%;
  }
  .dialog-title { font-size: 17px; font-weight: 600; margin: 0 0 8px; color: var(--text-1); }
  .dialog-msg   { font-size: 13px; color: var(--text-3); margin: 0 0 20px; line-height: 1.5; }
  .dialog-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .btn-danger { background: var(--danger, #ef4444); color: #fff; border: none; border-radius: var(--radius-md); padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }

  .oidc-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md);
  }
  .oidc-logo { width: 22px; height: 22px; object-fit: contain; flex: 0 0 auto; }
  .oidc-icon { font-size: 22px; flex: 0 0 auto; color: var(--text-3); }
  .oidc-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  /* Long issuer URLs and display names have no spaces — let them wrap
     anywhere so they don't push into the action icons on narrow viewports. */
  .oidc-info > * { min-width: 0; word-break: break-word; overflow-wrap: anywhere; }
  .oidc-name { font-weight: 600; }
  .oidc-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .oidc-test-result {
    padding: 10px; border-radius: var(--radius-md);
    background: var(--surface-2); border: 1px solid var(--border);
  }
  .oidc-test-result.ok { border-color: var(--success, #22c55e); }
  .oidc-form {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .oidc-preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
  }
  .oidc-preset-card {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 12px 8px;
    border: 1.5px solid var(--border); border-radius: var(--radius-md);
    background: var(--surface-1, var(--bg));
    cursor: pointer;
    color: inherit; font: inherit;
    transition: border-color 120ms, background 120ms;
  }
  .oidc-preset-card:hover { border-color: var(--accent); }
  .oidc-preset-card.selected {
    border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .oidc-preset-logo, .oidc-preset-icon { width: 28px; height: 28px; }
  .oidc-preset-icon { font-size: 28px !important; color: var(--text-3); }
  .oidc-preset-card.selected .oidc-preset-icon { color: var(--accent); }
  .oidc-preset-name { font-size: 12px; font-weight: 600; text-align: center; }
</style>
