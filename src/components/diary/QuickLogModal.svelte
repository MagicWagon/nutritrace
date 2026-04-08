<!--
  QuickLogModal — natural-language food logging via FitBot AI.

  Two phases:
    1. Input phase: text field + mic button. User types or speaks their meal.
    2. Review phase: list of parsed/matched items with edit/swap/remove +
       meal-slot picker, then "Add All" to write to diary.

  Used from Diary.svelte. Requires aiEnabled + quickLogEnabled.
-->
<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { mealNames } from '../../stores/settings.js';
  import { showError, showSuccess } from '../../stores/toast.js';
  import { parseInput, matchItems, saveItems } from '../../lib/quick-log.js';
  import { isNative } from '../../lib/platform.js';

  export let date;                  // 'YYYY-MM-DD'
  export let defaultMealSlot = 0;   // index into mealNames

  const dispatch = createEventDispatcher();

  let phase = 'input';              // 'input' | 'parsing' | 'review' | 'saving'
  let inputText = '';
  let inputEl;
  let listening = false;
  let recognition = null;
  let parsedItems = [];             // raw AI output
  let matchedItems = [];            // [{ item, candidates, best, source, food, quantity, mealSlot }]
  let errorMsg = '';

  $: meals = $mealNames || ['Breakfast','Lunch','Dinner','Snacks'];

  onMount(() => {
    setTimeout(() => inputEl?.focus(), 80);
    // Web Speech API is unreliable in Android WebView (mic permission, Google
    // cloud dependency, vendor inconsistencies). Only enable it on PWA where
    // it works in Chrome / Safari / Firefox. Native voice input would need
    // @capacitor-community/speech-recognition as a future enhancement.
    if (isNative) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || 'en-US';
      recognition.onresult = (e) => {
        const transcript = e.results[0]?.[0]?.transcript || '';
        if (transcript) {
          inputText = (inputText ? inputText + ' ' : '') + transcript;
        }
        listening = false;
      };
      recognition.onerror = (e) => {
        listening = false;
        console.warn('[quick-log] mic error:', e.error);
        showError('Voice input failed: ' + (e.error || 'unknown error'));
      };
      recognition.onend = () => { listening = false; };
    }
  });

  onDestroy(() => {
    if (recognition) try { recognition.abort(); } catch {}
  });

  function close() { dispatch('close'); }

  function toggleMic() {
    if (!recognition) {
      showError('Voice input not supported on this device.');
      return;
    }
    if (listening) {
      try { recognition.stop(); } catch {}
      listening = false;
    } else {
      try {
        recognition.start();
        listening = true;
      } catch (e) {
        showError('Could not start mic: ' + e.message);
      }
    }
  }

  async function runParse() {
    errorMsg = '';
    if (!inputText.trim()) return;
    phase = 'parsing';
    try {
      parsedItems = await parseInput(inputText);
      if (parsedItems.length === 0) {
        errorMsg = 'No food items found. Try rephrasing.';
        phase = 'input';
        return;
      }
      const matches = await matchItems(parsedItems);
      // Materialize each match into an editable row
      matchedItems = matches.map(m => ({
        ...m,
        food: m.best || null,                    // currently selected food record
        quantity: _defaultPortionFor(m),         // grams or units
        mealSlot: defaultMealSlot,
      }));
      phase = 'review';
    } catch (e) {
      console.error('[quick-log] parse failed:', e);
      errorMsg = e.message || 'Parse failed.';
      phase = 'input';
    }
  }

  function _defaultPortionFor(m) {
    // If the food has a portion size set (e.g. "1 slice = 30g"), use quantity * portion
    const food = m.best;
    if (!food) return 100;
    const basePortion = Number(food.portion) > 0 ? Number(food.portion) : 100;
    const qty = Number(m.item.quantity) > 0 ? Number(m.item.quantity) : 1;
    return basePortion * qty;
  }

  function removeRow(i) {
    matchedItems = matchedItems.filter((_, idx) => idx !== i);
    if (matchedItems.length === 0) {
      // Nothing left — back to input
      phase = 'input';
    }
  }

  function swapCandidate(i, candidate) {
    matchedItems[i] = { ...matchedItems[i], food: candidate };
    matchedItems = matchedItems;
  }

  async function commitAll() {
    if (matchedItems.length === 0) return;
    phase = 'saving';
    try {
      const { saved } = await saveItems(matchedItems, { date, defaultMealSlot });
      if (saved > 0) {
        showSuccess(`Logged ${saved} item${saved === 1 ? '' : 's'}`);
        dispatch('saved');
        dispatch('close');
      } else {
        errorMsg = 'Nothing was saved. All items missing food data.';
        phase = 'review';
      }
    } catch (e) {
      console.error('[quick-log] save failed:', e);
      errorMsg = 'Save failed: ' + e.message;
      phase = 'review';
    }
  }

  function backToInput() {
    phase = 'input';
    matchedItems = [];
    parsedItems = [];
    setTimeout(() => inputEl?.focus(), 80);
  }
</script>

<div class="ql-backdrop" transition:fade={{ duration: 150 }} on:click={close}></div>
<div class="ql-sheet" transition:fly={{ y: 400, duration: 280 }}>
  <div class="ql-handle"></div>
  <div class="ql-header">
    <span class="material-symbols-rounded" style="color:var(--accent)">auto_awesome</span>
    <span class="ql-title">Quick Log</span>
    <span class="labs-badge" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">Experimental</span>
    <button class="btn-icon" on:click={close} aria-label="Close" style="margin-left:auto">
      <span class="material-symbols-rounded">close</span>
    </button>
  </div>

  {#if phase === 'input'}
    <div class="ql-body">
      <p class="ql-hint">Type or speak what you ate. The AI will parse and match it to your foods.</p>
      <div class="ql-input-row">
        <input
          bind:this={inputEl}
          bind:value={inputText}
          on:keydown={(e) => e.key === 'Enter' && runParse()}
          class="input ql-input"
          placeholder="2 eggs and toast"
          autocomplete="off"
        />
        {#if recognition}
          <button class="btn-icon ql-mic" class:listening on:click={toggleMic} title={listening ? 'Stop' : 'Voice input'}>
            <span class="material-symbols-rounded">{listening ? 'stop_circle' : 'mic'}</span>
          </button>
        {/if}
      </div>
      {#if errorMsg}
        <div class="ql-error">{errorMsg}</div>
      {/if}
      <div class="ql-actions">
        <button class="btn btn-primary" on:click={runParse} disabled={!inputText.trim()}>
          <span class="material-symbols-rounded" style="font-size:16px">arrow_forward</span> Parse
        </button>
      </div>
      <div class="ql-examples">
        <div class="ql-example-label">Examples:</div>
        <button class="ql-example" on:click={() => { inputText = '2 eggs and a slice of toast'; }}>2 eggs and a slice of toast</button>
        <button class="ql-example" on:click={() => { inputText = 'a banana and a cup of coffee'; }}>a banana and a cup of coffee</button>
        <button class="ql-example" on:click={() => { inputText = 'bowl of oatmeal with blueberries'; }}>bowl of oatmeal with blueberries</button>
      </div>
    </div>

  {:else if phase === 'parsing'}
    <div class="ql-body ql-loading">
      <span class="material-symbols-rounded ql-spin" style="font-size:32px;color:var(--accent)">autorenew</span>
      <p>Parsing "{inputText}"…</p>
    </div>

  {:else if phase === 'review'}
    <div class="ql-body">
      <div class="ql-review-header">
        <button class="btn btn-secondary btn-sm" on:click={backToInput}>
          <span class="material-symbols-rounded" style="font-size:14px">arrow_back</span> Edit
        </button>
        <span class="ql-review-count">{matchedItems.length} item{matchedItems.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ql-list">
        {#each matchedItems as m, i}
          <div class="ql-row" class:unmatched={!m.food}>
            <div class="ql-row-main">
              <div class="ql-row-name">
                {m.food?.name || m.item.name}
                {#if m.source === 'local'}<span class="ql-badge ql-badge-local">Local</span>{/if}
                {#if m.source === 'off'}<span class="ql-badge ql-badge-off">OFF</span>{/if}
                {#if !m.food}<span class="ql-badge ql-badge-warn">Not found</span>{/if}
              </div>
              {#if m.food}
                <div class="ql-row-meta">
                  {Math.round((m.food.nutrition?.calories || 0) * (m.quantity / 100))} kcal · {m.quantity}{m.food.unit || 'g'}
                </div>
              {:else}
                <div class="ql-row-meta">No nutrition data — remove or add manually</div>
              {/if}
              {#if m.candidates && m.candidates.length > 1}
                <details class="ql-swap">
                  <summary>Swap match ({m.candidates.length})</summary>
                  <div class="ql-candidates">
                    {#each m.candidates as c}
                      <button class="ql-candidate" class:active={c === m.food} on:click={() => swapCandidate(i, c)}>
                        {c.name}{c.brand ? ' · ' + c.brand : ''}
                      </button>
                    {/each}
                  </div>
                </details>
              {/if}
            </div>
            <div class="ql-row-controls">
              <select class="select sel-sm ql-meal-pick" bind:value={m.mealSlot}>
                {#each meals as name, idx}
                  <option value={idx}>{name}</option>
                {/each}
              </select>
              <input type="number" class="input ql-qty" min="1" bind:value={m.quantity} />
              <button class="btn-icon" style="color:var(--danger)" on:click={() => removeRow(i)} aria-label="Remove">
                <span class="material-symbols-rounded" style="font-size:18px">close</span>
              </button>
            </div>
          </div>
        {/each}
      </div>
      {#if errorMsg}
        <div class="ql-error">{errorMsg}</div>
      {/if}
      <div class="ql-actions">
        <button class="btn btn-primary" on:click={commitAll} disabled={matchedItems.filter(m => m.food).length === 0}>
          <span class="material-symbols-rounded" style="font-size:16px">check</span>
          Add {matchedItems.filter(m => m.food).length} to Diary
        </button>
      </div>
    </div>

  {:else if phase === 'saving'}
    <div class="ql-body ql-loading">
      <span class="material-symbols-rounded ql-spin" style="font-size:32px;color:var(--accent)">autorenew</span>
      <p>Saving…</p>
    </div>
  {/if}
</div>

<style>
  .ql-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    z-index: 600;
  }
  .ql-sheet {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    background: var(--surface-1);
    border-top: 1px solid var(--border);
    border-radius: 20px 20px 0 0;
    z-index: 601;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 -8px 40px rgba(0,0,0,0.45);
    padding-bottom: var(--safe-bottom, 0px);
  }
  @media (min-width: 769px) {
    .ql-sheet {
      left: 50%; right: auto; bottom: 24px;
      transform: translateX(-50%);
      width: 480px;
      max-height: 80vh;
      border-radius: 16px;
      border: 1px solid var(--border);
    }
  }
  .ql-handle {
    width: 40px; height: 4px;
    border-radius: 2px;
    background: var(--text-3);
    opacity: 0.4;
    margin: 8px auto 4px;
    flex-shrink: 0;
  }
  .ql-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .ql-title { font-size: 16px; font-weight: 700; color: var(--text-1); }

  .ql-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ql-hint { font-size: 13px; color: var(--text-3); margin: 0; }

  .ql-input-row { display: flex; gap: 8px; align-items: center; }
  .ql-input { flex: 1; height: 44px; font-size: 15px; }
  .ql-mic {
    width: 44px; height: 44px;
    background: var(--surface-2);
    border-radius: 50%;
  }
  .ql-mic.listening {
    background: var(--accent-dim);
    color: var(--accent);
    animation: ql-pulse 1.4s ease-in-out infinite;
  }
  @keyframes ql-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  .ql-error {
    color: var(--danger);
    font-size: 13px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-radius: 6px;
  }

  .ql-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .ql-examples {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-top: 8px;
  }
  .ql-example-label {
    width: 100%;
    font-size: 11px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ql-example {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
    padding: 6px 10px;
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
  }
  .ql-example:hover { background: var(--accent-dim); color: var(--accent); }

  .ql-loading {
    align-items: center;
    text-align: center;
    padding: 40px 16px;
    color: var(--text-3);
  }
  .ql-spin { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .ql-review-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ql-review-count { font-size: 13px; color: var(--text-3); }

  .ql-list { display: flex; flex-direction: column; gap: 8px; }
  .ql-row {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ql-row.unmatched { border-color: var(--warning, #f59e0b); }
  .ql-row-main { display: flex; flex-direction: column; gap: 2px; }
  .ql-row-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ql-row-meta { font-size: 12px; color: var(--text-3); }

  .ql-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.04em;
  }
  .ql-badge-local { background: var(--accent-dim); color: var(--accent); }
  .ql-badge-off   { background: color-mix(in srgb, #3b82f6 20%, transparent); color: #60a5fa; }
  .ql-badge-warn  { background: color-mix(in srgb, var(--warning, #f59e0b) 20%, transparent); color: var(--warning, #f59e0b); }

  .ql-swap summary {
    font-size: 11px;
    color: var(--text-3);
    cursor: pointer;
    margin-top: 4px;
  }
  .ql-candidates {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding-left: 8px;
  }
  .ql-candidate {
    text-align: left;
    background: var(--surface-1);
    border: 1px solid var(--border);
    color: var(--text-2);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .ql-candidate.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }

  .ql-row-controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ql-meal-pick { flex: 1; min-width: 0; }
  .ql-qty {
    width: 64px;
    height: 32px;
    text-align: center;
    font-size: 13px;
  }
</style>
