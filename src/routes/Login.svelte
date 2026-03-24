<script>
  import { currentUser } from '../stores/auth.js';
  import { showError } from '../stores/toast.js';
  import { push } from 'svelte-spa-router';

  let username = '';
  let password = '';
  let loading  = false;

  async function login() {
    if (!username.trim() || !password) return;
    loading = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Login failed'); return; }
      localStorage.setItem('wl:userId', String(data.user.id));
      currentUser.set(data.user);
      push('/');
    } catch(e) {
      showError('Could not reach server');
    } finally {
      loading = false;
    }
  }

  function onKey(e) { if (e.key === 'Enter') login(); }
</script>

<div class="login-page">
  <div class="login-card card">
    <div class="login-logo">
      <span class="material-symbols-rounded" style="font-size:48px;color:var(--accent)">nutrition</span>
      <h1 class="login-title">NutriTrace</h1>
      <p class="text-3 text-sm">Sign in to your account</p>
    </div>

    <div class="form-group">
      <label class="form-label">Username</label>
      <input class="input" type="text" autocomplete="username"
        bind:value={username} on:keydown={onKey}
        placeholder="Enter username" autofocus />
    </div>

    <div class="form-group">
      <label class="form-label">Password</label>
      <input class="input" type="password" autocomplete="current-password"
        bind:value={password} on:keydown={onKey}
        placeholder="Enter password" />
    </div>

    <button class="btn btn-primary w-full" class:loading on:click={login} disabled={loading || !username || !password}>
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
  </div>
</div>

<style>
  .login-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
  }
  .login-card {
    width: 100%;
    max-width: 360px;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .login-logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    text-align: center;
  }
  .login-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
  }
</style>
