<script>
  import { push } from 'svelte-spa-router';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { DB } from '../lib/db.js';
  import { Nutrition } from '../lib/nutrition.js';
  import { mealNames, energyUnit, goals, weightUnit, heightUnit } from '../stores/settings.js';

  const STEPS = ['welcome','gender','dob','height','weight','target','activity','summary'];

  let step = 0;
  let dir  = 1; // 1 = forward, -1 = back (for transition direction)

  // Profile data
  let gender   = '';
  let dob      = (new Date().getFullYear() - 25) + '-01-01';
  let heightCm = 170;
  let heightFt = 5;
  let heightIn = 9;
  let weight   = 70;
  let targetW  = 65;
  let activity = '';

  // Computed TDEE / goal for summary step
  let tdee = 0;
  let goalKcal = 0;

  const ACTIVITY_LEVELS = [
    { value: 'sedentary',   label: 'Sedentary',          desc: 'Little or no exercise' },
    { value: 'light',       label: 'Lightly Active',      desc: 'Light exercise 1–3 days/week' },
    { value: 'moderate',    label: 'Moderately Active',   desc: 'Moderate exercise 3–5 days/week' },
    { value: 'active',      label: 'Very Active',         desc: 'Hard exercise 6–7 days/week' },
    { value: 'very_active', label: 'Extremely Active',    desc: 'Very hard exercise & physical job' },
  ];

  $: wUnit = $weightUnit || 'kg';
  $: hUnit = $heightUnit || 'cm';

  function toKg(v) {
    if (wUnit === 'lb') return v * 0.453592;
    if (wUnit === 'st') return v * 6.35029;
    return v;
  }

  function getHeightCm() {
    if (hUnit === 'cm') return heightCm;
    return Math.round(heightFt * 30.48 + heightIn * 2.54);
  }

  function calcSummary() {
    const ageMs = Date.now() - new Date(dob).getTime();
    const age   = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
    const wKg   = toKg(weight);
    const tWKg  = toKg(targetW);
    const hCm   = getHeightCm();
    tdee = Nutrition.calculateTDEE({
      gender: gender || 'male',
      age: Math.max(15, age),
      height_cm: hCm,
      weight_kg: wKg,
      activity: activity || 'sedentary'
    });
    if (tWKg < wKg * 0.99)      goalKcal = Math.round(tdee * 0.80);
    else if (tWKg > wKg * 1.01) goalKcal = Math.round(tdee * 1.20);
    else                         goalKcal = tdee;
  }

  function next() {
    if (step === STEPS.length - 1) { finish(); return; }
    // Validation
    if (STEPS[step] === 'gender' && !gender) return;
    if (STEPS[step] === 'activity' && !activity) return;
    if (STEPS[step] === 'summary') { finish(); return; }
    dir = 1;
    step++;
    if (STEPS[step] === 'summary') calcSummary();
  }

  function prev() {
    if (step === 0) return;
    dir = -1;
    step--;
  }

  function skip() {
    DB.setSetting('setupComplete', true);
    push('/');
  }

  function finish() {
    const wKg = toKg(weight);
    const tKg = toKg(targetW);
    const hCm = getHeightCm();
    DB.setSetting('gender', gender || 'male');
    DB.setSetting('dob', dob);
    DB.setSetting('height_cm', hCm);
    DB.setSetting('weight_kg', wKg);
    DB.setSetting('target_weight', tKg);
    DB.setSetting('activity', activity || 'sedentary');
    DB.setSetting('tdee', tdee || 2000);
    if (goalKcal) {
      const current = DB.getSetting('goals', {});
      goals.set({ ...current, calories: { max: goalKcal, sharedGoal: true, isMin: false, showInDiary: true, showInStats: true, days: Array(7).fill(goalKcal) } });
    }
    DB.setSetting('setupComplete', true);
    push('/');
  }

  $: btnLabel = step === STEPS.length - 1 ? 'Finish'
    : step === 0 ? 'Get Started' : 'Next';

  $: canProceed = !(STEPS[step] === 'gender' && !gender)
               && !(STEPS[step] === 'activity' && !activity);
</script>

<div class="wizard-shell">
  <!-- Skip button -->
  <div class="wizard-topbar">
    {#if step > 0 && step < STEPS.length - 1}
      <button class="btn btn-ghost wizard-skip" on:click={skip}>Skip</button>
    {:else}
      <div></div>
    {/if}
  </div>

  <!-- Progress dots -->
  <div class="progress-dots">
    {#each STEPS as _, i}
      <div class="dot" class:active={i <= step} class:current={i === step}></div>
    {/each}
  </div>

  {#key step}
    <div class="wizard-step"
      in:fly={{ x: dir * 40, duration: 260, easing: cubicOut, opacity: 0 }}
      out:fade={{ duration: 100 }}>

      <!-- ── Welcome ── -->
      {#if STEPS[step] === 'welcome'}
        <div class="step-hero">
          <div class="logo-icon">🥗</div>
          <h1 class="step-title">Welcome to NutriTrace</h1>
          <p class="step-desc">Your personal nutrition tracker. Let's get you set up in about a minute.</p>
        </div>

      <!-- ── Gender ── -->
      {:else if STEPS[step] === 'gender'}
        <h2 class="step-title">What is your gender?</h2>
        <p class="step-desc">Used to calculate your calorie needs.</p>
        <div class="gender-cards">
          {#each [['male','man','Male'],['female','woman','Female']] as [val, icon, lbl]}
            <button class="option-card" class:selected={gender === val}
              on:click={() => gender = val}>
              <span class="material-symbols-rounded" style="font-size:48px">{icon}</span>
              <span class="option-label">{lbl}</span>
              {#if gender === val}
                <span class="material-symbols-rounded check">check_circle</span>
              {/if}
            </button>
          {/each}
        </div>

      <!-- ── Date of Birth ── -->
      {:else if STEPS[step] === 'dob'}
        <h2 class="step-title">When were you born?</h2>
        <p class="step-desc">Your age affects your metabolic rate.</p>
        <input class="input" type="date" bind:value={dob}
          max={new Date().toISOString().slice(0,10)}
          style="margin-top:24px;font-size:16px" />

      <!-- ── Height ── -->
      {:else if STEPS[step] === 'height'}
        <h2 class="step-title">What is your height?</h2>
        <p class="step-desc">Used to estimate your calorie needs.</p>
        <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px">
          {#if hUnit === 'cm'}
            <label class="form-label">Height (cm)</label>
            <input class="input" type="number" min="100" max="250" bind:value={heightCm} style="font-size:16px" />
          {:else}
            <label class="form-label">Height</label>
            <div style="display:flex;gap:10px">
              <div style="flex:1">
                <label class="form-label" style="font-size:11px">Feet</label>
                <input class="input" type="number" min="3" max="8" bind:value={heightFt} style="font-size:16px" />
              </div>
              <div style="flex:1">
                <label class="form-label" style="font-size:11px">Inches</label>
                <input class="input" type="number" min="0" max="11" bind:value={heightIn} style="font-size:16px" />
              </div>
            </div>
          {/if}
        </div>

      <!-- ── Current Weight ── -->
      {:else if STEPS[step] === 'weight'}
        <h2 class="step-title">What is your weight?</h2>
        <p class="step-desc">Your current body weight ({wUnit}).</p>
        <input class="input" type="number" min="20" max="500" step="0.1"
          bind:value={weight} style="margin-top:24px;font-size:16px" />

      <!-- ── Target Weight ── -->
      {:else if STEPS[step] === 'target'}
        <h2 class="step-title">What is your target weight?</h2>
        <p class="step-desc">Your goal weight ({wUnit}). Leave same as current to maintain.</p>
        <input class="input" type="number" min="20" max="500" step="0.1"
          bind:value={targetW} style="margin-top:24px;font-size:16px" />

      <!-- ── Activity Level ── -->
      {:else if STEPS[step] === 'activity'}
        <h2 class="step-title">How active are you?</h2>
        <p class="step-desc">Affects your daily calorie needs.</p>
        <div class="activity-list">
          {#each ACTIVITY_LEVELS as lvl}
            <button class="activity-card" class:selected={activity === lvl.value}
              on:click={() => activity = lvl.value}>
              <div class="activity-label" class:selected={activity === lvl.value}>{lvl.label}</div>
              <div class="activity-desc">{lvl.desc}</div>
              {#if activity === lvl.value}
                <span class="material-symbols-rounded check">check_circle</span>
              {/if}
            </button>
          {/each}
        </div>

      <!-- ── Summary ── -->
      {:else if STEPS[step] === 'summary'}
        <h2 class="step-title">Your Daily Calorie Goal</h2>
        <p class="step-desc">Based on your stats using the Mifflin-St Jeor formula.</p>
        <div class="summary-card">
          <div class="tdee-row">
            <div class="tdee-label">Estimated TDEE</div>
            <div class="tdee-value">{tdee}</div>
            <div class="tdee-unit">kcal / day</div>
          </div>
          <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
          <div class="summary-rows">
            <div class="summary-row">
              <span class="text-3">Suggested goal</span>
              <strong>{goalKcal} kcal/day</strong>
            </div>
            <div class="summary-row">
              <span class="text-3">Current weight</span>
              <span>{weight} {wUnit}</span>
            </div>
            <div class="summary-row">
              <span class="text-3">Target weight</span>
              <span>{targetW} {wUnit}</span>
            </div>
            <div class="summary-row">
              <span class="text-3">Activity level</span>
              <span>{ACTIVITY_LEVELS.find(l=>l.value===activity)?.label || activity}</span>
            </div>
          </div>
          <p class="text-3" style="font-size:12px;margin-top:12px;text-align:center">
            You can adjust this anytime in Goals → Settings.
          </p>
        </div>
      {/if}

    </div>
  {/key}

  <!-- Nav buttons -->
  <div class="wizard-nav">
    {#if step > 0}
      <button class="btn btn-secondary" on:click={prev}>Back</button>
    {:else}
      <div></div>
    {/if}
    <button class="btn btn-primary" on:click={next} disabled={!canProceed}>
      {btnLabel}
    </button>
  </div>
</div>

<style>
  .wizard-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: calc(var(--safe-top) + 16px) var(--page-px) calc(var(--safe-bottom) + 24px);
    gap: 24px;
  }
  .wizard-topbar { display: flex; justify-content: flex-end; min-height: 32px; }
  .wizard-skip { font-size: 14px; color: var(--text-3); height: 32px; padding: 0 8px; }

  .progress-dots { display: flex; gap: 6px; justify-content: center; }
  .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--surface-3);
    transition: all var(--dur-base) var(--ease-spring);
  }
  .dot.active  { background: var(--accent-dim); }
  .dot.current { background: var(--accent); width: 22px; border-radius: var(--radius-full); }

  .wizard-step { flex: 1; display: flex; flex-direction: column; gap: 20px; }

  .step-hero {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; text-align: center; padding: 24px 0;
  }
  .logo-icon { font-size: 72px; line-height: 1; }
  .step-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .step-desc  { font-size: 16px; color: var(--text-2); line-height: 1.6; max-width: 320px; }

  /* Gender cards */
  .gender-cards { display: flex; gap: 16px; margin-top: 16px; }
  .option-card {
    flex: 1;
    display: flex; flex-direction: column; align-items: center;
    gap: 8px; padding: 24px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-1); border: 2px solid var(--border);
    cursor: pointer; position: relative;
    transition: border-color var(--dur-fast), background var(--dur-fast);
    color: var(--text-1);
  }
  .option-card.selected { border-color: var(--accent); background: var(--accent-dim); }
  .option-label { font-size: 16px; font-weight: 600; }
  .check { position: absolute; right: 10px; top: 10px; color: var(--accent); font-size: 20px; }

  /* Activity list */
  .activity-list { display: flex; flex-direction: column; gap: 8px; }
  .activity-card {
    display: flex; flex-direction: column; align-items: flex-start;
    gap: 2px; padding: 12px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-1); border: 2px solid var(--border);
    cursor: pointer; position: relative; text-align: left;
    transition: border-color var(--dur-fast), background var(--dur-fast);
    color: var(--text-1);
  }
  .activity-card.selected { border-color: var(--accent); background: var(--accent-dim); }
  .activity-label { font-size: 15px; font-weight: 600; color: var(--text-1); }
  .activity-label.selected { color: var(--accent); }
  .activity-desc { font-size: 12px; color: var(--text-3); }

  /* Summary */
  .summary-card {
    background: var(--surface-1); border-radius: var(--radius-lg);
    padding: 20px; border: 1px solid var(--border);
    margin-top: 8px;
  }
  .tdee-row { text-align: center; }
  .tdee-label { font-size: 13px; color: var(--text-3); margin-bottom: 4px; }
  .tdee-value { font-size: 48px; font-weight: 700; color: var(--accent); line-height: 1; }
  .tdee-unit  { font-size: 14px; color: var(--text-3); margin-top: 4px; }
  .summary-rows { display: flex; flex-direction: column; gap: 8px; }
  .summary-row { display: flex; justify-content: space-between; font-size: 14px; }

  .wizard-nav {
    display: flex; justify-content: space-between; gap: 12px;
  }
  .wizard-nav .btn { flex: 1; }
</style>
