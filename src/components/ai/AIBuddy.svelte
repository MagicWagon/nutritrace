<script>
  import { onMount, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { NtApi }     from '../../lib/api.js';
  import { localDateStr } from '../../lib/db.js';
  import { Nutrition } from '../../lib/nutrition.js';
  import { callAI, callAIProxy } from '../../lib/aiChat.js';
  import { aiEnabled, aiAssistantName, aiApiKey, aiProvider, aiModel, goals, mealNames, energyUnit } from '../../stores/settings.js';
  import { showError } from '../../stores/toast.js';

  // ── State ──────────────────────────────────────────────────────────────────
  let panelOpen  = false;
  let messages   = [];   // { role, content, time }
  let input      = '';
  let loading    = false;
  let messagesEl;
  let hasUnread  = false;

  // Whether AI config is locked via env vars (proxy mode)
  let aiEnvLocked = false;

  // Settings — refreshed each time panel opens
  let assistantName = 'FitBot';
  let apiKey        = '';

  $: if (panelOpen) {
    hasUnread     = false;
    assistantName = $aiAssistantName;
    apiKey        = $aiApiKey;
  }

  onMount(async () => {
    try {
      const saved = localStorage.getItem('wl:aiChatHistory');
      if (saved) messages = JSON.parse(saved);
    } catch {}
    try {
      const res = await fetch('/api/app-config/env-locks', { credentials: 'include' });
      if (res.ok) { const d = await res.json(); aiEnvLocked = !!d.ai; }
    } catch {}
  });

  // ── Draggable FAB ──────────────────────────────────────────────────────────
  /** Saved position: { x, y } from top-left, or null → use CSS default (bottom-right) */
  let fabPos    = (() => {
    try { return JSON.parse(localStorage.getItem('wl:aiFabPos') || 'null'); } catch { return null; }
  })();
  let hasDragged = false;

  $: fabStyle = fabPos
    ? `left:${fabPos.x}px; top:${fabPos.y}px; right:auto; bottom:auto;`
    : '';

  function startDrag(e) {
    hasDragged = false;
    const startX   = e.clientX;
    const startY   = e.clientY;
    // Compute current absolute position (default bottom-right when no saved pos)
    const baseX = fabPos ? fabPos.x : window.innerWidth  - 76;
    const baseY = fabPos ? fabPos.y : window.innerHeight - 160;

    function move(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!hasDragged && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) hasDragged = true;
      if (hasDragged) {
        fabPos = {
          x: Math.max(8, Math.min(window.innerWidth  - 64, baseX + dx)),
          y: Math.max(8, Math.min(window.innerHeight - 64, baseY + dy)),
        };
      }
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup',   up);
      if (hasDragged) localStorage.setItem('wl:aiFabPos', JSON.stringify(fabPos));
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup',   up);
  }

  function handleFabClick() {
    if (!hasDragged) panelOpen = !panelOpen;
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  async function buildContext() {
    const today  = localDateStr();
    const entry  = await NtApi.getDiaryDate(today).catch(() => null);
    const g      = goals.get();
    const mNames = mealNames.get();
    const eUnit  = energyUnit.get();

    let diaryText = 'No food logged today yet.';
    if (entry && entry.items?.length) {
      const tot  = Nutrition.sum(entry.items.map(i => Nutrition.calculate(i)));
      diaryText  = `Totals: ${Math.round(tot.calories||0)} ${eUnit}, `
                 + `${Math.round(tot.proteins||0)}g protein, `
                 + `${Math.round(tot.carbohydrates||0)}g carbs, `
                 + `${Math.round(tot.fat||0)}g fat.\n`;
      const byMeal = {};
      for (const it of entry.items) {
        const m = it.meal ?? 0;
        (byMeal[m] = byMeal[m] || []).push(it);
      }
      for (const [mIdx, items] of Object.entries(byMeal)) {
        const mName = mNames[Number(mIdx)] || `Meal ${Number(mIdx)+1}`;
        diaryText += `${mName}: ${items.map(i => `${i.name} (${i.portion||100}${i.unit||'g'})`).join(', ')}\n`;
      }
    }

    const calGoal  = g.calories?.max        ?? g.calories?.min;
    const proGoal  = g.proteins?.max        ?? g.proteins?.min;
    const carbGoal = g.carbohydrates?.max   ?? g.carbohydrates?.min;
    const fatGoal  = g.fat?.max             ?? g.fat?.min;
    let goalsText  = 'No goals set.';
    if (calGoal || proGoal || carbGoal || fatGoal) {
      goalsText = [
        calGoal  && `Calories: ${calGoal} ${eUnit}`,
        proGoal  && `Protein: ${proGoal}g`,
        carbGoal && `Carbs: ${carbGoal}g`,
        fatGoal  && `Fat: ${fatGoal}g`,
      ].filter(Boolean).join(', ');
    }

    let statsText = '';
    if (entry?.bodyStats) {
      const bs    = entry.bodyStats;
      const parts = [];
      if (bs.weight)   parts.push(`Weight: ${bs.weight}`);
      if (bs.body_fat) parts.push(`Body fat: ${bs.body_fat}%`);
      if (parts.length) statsText = parts.join(', ');
    }

    return { today, diaryText, goalsText, statsText };
  }

  function buildSystemPrompt(ctx) {
    const name = $aiAssistantName;
    return `You are ${name}, a friendly AI nutrition and fitness coach built into the NutriTrace app. `
         + `You help users make healthy food choices, understand their nutrition, and reach their fitness goals. `
         + `Be warm, encouraging, and concise. Give practical, evidence-based advice. Keep responses focused.\n\n`
         + `Current date: ${ctx.today}\n\n`
         + `TODAY'S FOOD LOG:\n${ctx.diaryText}\n`
         + `DAILY GOALS:\n${ctx.goalsText}`
         + (ctx.statsText ? `\n\nBODY STATS TODAY:\n${ctx.statsText}` : '');
  }

  function fmtTime() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function send() {
    const content = input.trim();
    if (!content || loading) return;

    const key      = $aiApiKey;
    const provider = aiProvider.get() || 'claude';
    const model    = aiModel.get()    || undefined;

    if (!aiEnvLocked && !key) { showError('Add your API key in Settings → FitBot AI'); return; }

    messages = [...messages, { role: 'user', content, time: fmtTime() }];
    input    = '';
    loading  = true;
    await tick();
    _scrollBottom();

    try {
      const ctx          = await buildContext();
      const systemPrompt = buildSystemPrompt(ctx);
      // Strip 'time' field before sending; limit to last 20 for context window
      const apiMessages  = messages
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-20);
      const reply = aiEnvLocked
        ? await callAIProxy({ messages: apiMessages, systemPrompt })
        : await callAI({ provider, apiKey: key, model, messages: apiMessages, systemPrompt });
      messages = [...messages, { role: 'assistant', content: reply, time: fmtTime() }];
      localStorage.setItem('wl:aiChatHistory', JSON.stringify(messages.slice(-100)));
      if (!panelOpen) hasUnread = true;
    } catch (e) {
      showError(e.message || 'AI request failed');
    } finally {
      loading = false;
      await tick();
      _scrollBottom();
    }
  }

  function _scrollBottom() {
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function clearChat() {
    messages = [];
    localStorage.removeItem('wl:aiChatHistory');
  }

  function quickAsk(q) { input = q; send(); }
</script>

{#if $aiEnabled}
  <!-- ── Floating Action Button ─────────────────────────────────────────── -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="ai-fab"
    class:panel-open={panelOpen}
    class:has-unread={hasUnread}
    style={fabStyle}
    on:pointerdown={startDrag}
    on:click={handleFabClick}
    on:keydown={e => e.key === 'Enter' && handleFabClick()}
    role="button"
    tabindex="0"
    aria-label="Open AI coach"
    title="FitBot AI"
  >
    {#if loading}
      <div class="fab-spinner"></div>
    {:else if panelOpen}
      <span class="material-symbols-rounded" style="font-size:26px">close</span>
    {:else}
      <span class="material-symbols-rounded" style="font-size:26px">smart_toy</span>
    {/if}
    {#if hasUnread && !panelOpen}
      <div class="fab-badge" transition:fade={{ duration: 120 }}></div>
    {/if}
  </div>

  <!-- ── Panel Backdrop ─────────────────────────────────────────────────── -->
  {#if panelOpen}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="ai-backdrop"
      transition:fade={{ duration: 200 }}
      on:click={() => panelOpen = false}
      on:keydown={() => {}}
    ></div>

    <!-- ── Chat Panel ──────────────────────────────────────────────────── -->
    <aside
      class="ai-panel"
      transition:fly={{ x: 440, duration: 300, easing: cubicOut }}
      aria-label="AI coach chat"
    >
      <!-- Header -->
      <div class="ai-header">
        <div class="ai-header-brand">
          <div class="ai-avatar">
            <span class="material-symbols-rounded">smart_toy</span>
          </div>
          <div>
            <div class="ai-header-name">{assistantName}</div>
            <div class="ai-header-sub">Your AI nutrition coach</div>
          </div>
        </div>
        <div class="ai-header-actions">
          <button class="btn-icon" on:click={clearChat} title="Clear conversation">
            <span class="material-symbols-rounded">delete_sweep</span>
          </button>
          <button class="btn-icon" on:click={() => panelOpen = false} title="Close">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div class="ai-messages" bind:this={messagesEl}>
        {#if !apiKey}
          <!-- Setup needed -->
          <div class="ai-setup">
            <span class="material-symbols-rounded ai-setup-icon">key</span>
            <p class="ai-setup-title">API key required</p>
            <p class="ai-setup-desc">Add your AI provider key in <strong>Settings → FitBot AI</strong> to start chatting.</p>
            <p class="ai-setup-desc" style="margin-top:4px">Supports Anthropic Claude, OpenAI, and Google Gemini.</p>
            <a href="#/settings" class="btn btn-primary" style="margin-top:16px" on:click={() => panelOpen = false}>
              Open Settings
            </a>
          </div>

        {:else if messages.length === 0}
          <!-- Welcome screen -->
          <div class="ai-welcome">
            <div class="ai-welcome-avatar">
              <span class="material-symbols-rounded">smart_toy</span>
            </div>
            <p class="ai-welcome-name">Hi, I'm {assistantName}!</p>
            <p class="ai-welcome-desc">Ask me about your nutrition, goals, or any health questions. I can see today's diary and your goals.</p>
            <div class="ai-quick-chips">
              <button class="ai-chip" on:click={() => quickAsk("How am I doing today?")}>
                How am I doing today?
              </button>
              <button class="ai-chip" on:click={() => quickAsk("What should I eat for my next meal?")}>
                Meal suggestion
              </button>
              <button class="ai-chip" on:click={() => quickAsk("Am I on track with my goals?")}>
                Goal progress
              </button>
            </div>
          </div>

        {:else}
          <!-- Message list -->
          {#each messages as msg (msg.time + msg.role + msg.content.slice(0,10))}
            <div class="ai-msg" class:user={msg.role === 'user'}>
              {#if msg.role === 'assistant'}
                <div class="ai-msg-avatar">
                  <span class="material-symbols-rounded">smart_toy</span>
                </div>
              {/if}
              <div class="ai-msg-body">
                <div class="ai-bubble">{msg.content}</div>
                {#if msg.time}
                  <div class="ai-time">{msg.time}</div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}

        <!-- Typing indicator -->
        {#if loading}
          <div class="ai-msg">
            <div class="ai-msg-avatar">
              <span class="material-symbols-rounded">smart_toy</span>
            </div>
            <div class="ai-msg-body">
              <div class="ai-bubble ai-typing">
                <span class="ai-dot"></span>
                <span class="ai-dot"></span>
                <span class="ai-dot"></span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input bar -->
      <div class="ai-input-bar">
        <textarea
          class="ai-textarea"
          bind:value={input}
          placeholder="Ask me anything…"
          on:keydown={onKey}
          rows="1"
          disabled={loading}
        ></textarea>
        <button class="ai-send-btn" on:click={send} disabled={loading || !input.trim()}>
          <span class="material-symbols-rounded">send</span>
        </button>
      </div>
    </aside>
  {/if}
{/if}

<style>
  /* ── Floating button ──────────────────────────────────────────────────── */
  .ai-fab {
    position: fixed;
    right: 20px;
    bottom: calc(var(--nav-h) + var(--safe-bottom, 0px) + 20px);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--accent-text);
    border: none;
    cursor: pointer;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.35), 0 0 0 0 transparent;
    animation: ai-float 3s ease-in-out infinite;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .ai-fab:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 28px rgba(0,0,0,0.45), 0 0 0 10px var(--accent-dim);
  }
  .ai-fab:active    { transform: scale(0.94); }
  .ai-fab.panel-open { animation: none; }

  @keyframes ai-float {
    0%, 100% { transform: translateY(0px);   box-shadow: 0 4px 20px rgba(0,0,0,0.35), 0 0 0 0 transparent; }
    50%       { transform: translateY(-5px);  box-shadow: 0 8px 28px rgba(0,0,0,0.45), 0 0 0 8px var(--accent-dim); }
  }

  /* Spinner when loading */
  .fab-spinner {
    width: 26px; height: 26px;
    border: 3px solid var(--accent-text);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Unread badge dot */
  .fab-badge {
    position: absolute;
    top: 3px; right: 3px;
    width: 13px; height: 13px;
    border-radius: 50%;
    background: var(--danger);
    border: 2px solid var(--bg);
    animation: badge-pulse 2s ease-in-out infinite;
  }
  @keyframes badge-pulse {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.2); }
  }

  /* ── Backdrop ─────────────────────────────────────────────────────────── */
  .ai-backdrop {
    position: fixed; inset: 0;
    background: var(--overlay);
    backdrop-filter: var(--backdrop-blur);
    -webkit-backdrop-filter: var(--backdrop-blur);
    z-index: 440;
  }

  /* ── Chat Panel ───────────────────────────────────────────────────────── */
  .ai-panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: min(420px, 100vw);
    background: var(--surface-1);
    border-left: 1px solid var(--border);
    z-index: 450;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    padding-top: var(--safe-top, 0px);
    padding-bottom: var(--safe-bottom, 0px);
  }

  /* Header */
  .ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: linear-gradient(135deg, var(--accent-dim), transparent);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .ai-header-brand { display: flex; align-items: center; gap: 12px; }
  .ai-avatar {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-text);
    flex-shrink: 0;
  }
  .ai-avatar .material-symbols-rounded { font-size: 22px; }
  .ai-header-name { font-size: 15px; font-weight: 700; color: var(--text-1); }
  .ai-header-sub  { font-size: 11px; color: var(--text-3); margin-top: 1px; }
  .ai-header-actions { display: flex; gap: 4px; }

  /* Messages area */
  .ai-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overscroll-behavior: contain;
  }

  /* Setup screen */
  .ai-setup {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 40px 24px; gap: 8px;
    margin: auto 0;
  }
  .ai-setup-icon { font-size: 48px; color: var(--accent); opacity: 0.6; }
  .ai-setup-title { font-size: 17px; font-weight: 700; color: var(--text-1); margin-top: 4px; }
  .ai-setup-desc  { font-size: 13px; color: var(--text-3); line-height: 1.5; }

  /* Welcome screen */
  .ai-welcome {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 32px 24px; gap: 10px;
    margin: auto 0;
  }
  .ai-welcome-avatar {
    width: 64px; height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-text);
    margin-bottom: 4px;
  }
  .ai-welcome-avatar .material-symbols-rounded { font-size: 32px; }
  .ai-welcome-name { font-size: 18px; font-weight: 700; color: var(--text-1); }
  .ai-welcome-desc { font-size: 13px; color: var(--text-2); line-height: 1.6; max-width: 280px; }
  .ai-quick-chips {
    display: flex; flex-wrap: wrap; gap: 8px;
    justify-content: center; margin-top: 8px;
  }
  .ai-chip {
    padding: 7px 14px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px; font-weight: 500;
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
  }
  .ai-chip:hover {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Message bubbles */
  .ai-msg {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    max-width: 100%;
  }
  .ai-msg.user {
    flex-direction: row-reverse;
  }
  .ai-msg-avatar {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: var(--accent-dim);
    color: var(--accent);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .ai-msg-avatar .material-symbols-rounded { font-size: 16px; }
  .ai-msg-body {
    display: flex; flex-direction: column; gap: 3px;
    max-width: calc(100% - 40px);
  }
  .ai-msg.user .ai-msg-body { align-items: flex-end; }

  .ai-bubble {
    padding: 10px 14px;
    border-radius: 18px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* AI bubble */
  .ai-msg:not(.user) .ai-bubble {
    background: var(--surface-2);
    color: var(--text-1);
    border-bottom-left-radius: 6px;
  }
  /* User bubble */
  .ai-msg.user .ai-bubble {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--accent-text);
    border-bottom-right-radius: 6px;
  }

  .ai-time {
    font-size: 10px;
    color: var(--text-3);
    padding: 0 4px;
  }

  /* Typing dots */
  .ai-typing {
    display: flex; align-items: center; gap: 5px;
    padding: 12px 16px;
    min-width: 60px;
  }
  .ai-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--text-3);
    animation: ai-bounce 1.4s ease-in-out infinite;
  }
  .ai-dot:nth-child(2) { animation-delay: 0.2s; }
  .ai-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes ai-bounce {
    0%, 60%, 100% { transform: translateY(0);    opacity: 0.4; }
    30%            { transform: translateY(-6px); opacity: 1;   }
  }

  /* Input bar */
  .ai-input-bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface-1);
    flex-shrink: 0;
  }
  .ai-textarea {
    flex: 1;
    resize: none;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    font-size: 14px;
    font-family: inherit;
    color: var(--text-1);
    line-height: 1.5;
    max-height: 120px;
    overflow-y: auto;
    transition: border-color var(--dur-fast);
  }
  .ai-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ai-textarea::placeholder { color: var(--text-3); }

  .ai-send-btn {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--accent-text);
    border: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: transform var(--dur-fast), opacity var(--dur-fast);
  }
  .ai-send-btn:disabled { opacity: 0.4; cursor: default; }
  .ai-send-btn:not(:disabled):hover  { transform: scale(1.08); }
  .ai-send-btn:not(:disabled):active { transform: scale(0.94); }
  .ai-send-btn .material-symbols-rounded { font-size: 20px; }
</style>
