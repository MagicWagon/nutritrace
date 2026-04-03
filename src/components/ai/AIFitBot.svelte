<script>
  import { onMount, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { NtApi }     from '../../lib/api.js';
  import { localDateStr } from '../../lib/db.js';
  import { Nutrition } from '../../lib/nutrition.js';
  import { callAI, callAIProxy } from '../../lib/aiChat.js';
  import { aiEnabled, aiAssistantName, aiApiKey, aiProvider, aiModel, goals, mealNames, energyUnit, dateFormat, tempUnit } from '../../stores/settings.js';
  import { showError } from '../../stores/toast.js';
  import { isNative } from '../../lib/platform.js';

  // ── State ──────────────────────────────────────────────────────────────────
  let panelOpen  = false;
  let messages   = [];   // { role, content, time, image? }
  let input      = '';
  let loading    = false;
  let messagesEl;
  let hasUnread  = false;
  let attachedImage = null; // { base64, mimeType, preview }
  let fileInput;
  let _cameraInput;
  let _showAttachMenu = false;
  let _hasCamera = false;

  // Check if device has a camera (PWA only)
  if (!isNative && navigator.mediaDevices?.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      _hasCamera = devices.some(d => d.kind === 'videoinput');
    }).catch(() => {});
  }

  // Whether AI config is locked via env vars (proxy mode)
  let aiEnvLocked = false;

  // Settings — refreshed each time panel opens
  let assistantName = 'FitBot';
  let apiKey        = '';

  $: if (panelOpen) {
    hasUnread     = false;
    assistantName = $aiAssistantName;
    apiKey        = $aiApiKey;
    tick().then(() => _scrollBottom(true));
  }

  onMount(async () => {
    // Load history from server; fall back to localStorage for offline / migration
    try {
      const rows = await NtApi.get('/api/ai/history');
      if (rows.length) {
        messages = rows.map(r => ({ role: r.role, content: r.content, time: _fmtCreatedAt(r.created_at) }));
        localStorage.removeItem('wl:aiChatHistory'); // clear migrated local copy
      } else {
        const saved = localStorage.getItem('wl:aiChatHistory');
        if (saved) {
          const local = JSON.parse(saved);
          if (local.length) {
            // Migrate localStorage messages to server
            messages = local;
            for (const m of local) {
              await NtApi.post('/api/ai/history', { role: m.role, content: m.content }).catch(() => {});
            }
            localStorage.removeItem('wl:aiChatHistory');
          }
        }
      }
    } catch {
      try {
        const saved = localStorage.getItem('wl:aiChatHistory');
        if (saved) messages = JSON.parse(saved);
      } catch {}
    }
    try {
      const { isNative, getServerUrl, apiUrl } = await import('../../lib/platform.js');
      if (!(isNative && !getServerUrl())) {
        const res = await fetch(apiUrl('/api/app-config/env-locks'), { credentials: 'include' });
        if (res.ok) { const d = await res.json(); aiEnvLocked = !!d.ai; }
      }
    } catch {}
  });

  function _fmtCreatedAt(iso) {
    if (!iso) return fmtTime();
    const d       = new Date(iso + 'Z');
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // Compare date portion in local time
    const msgDate = d.toLocaleDateString('sv-SE'); // reliable YYYY-MM-DD in local tz
    if (msgDate === localDateStr()) return timeStr;
    // Older message — prefix with date in user's preferred format
    const fmt = dateFormat.get() || 'ISO';
    const mo  = String(d.getMonth() + 1).padStart(2, '0');
    const dy  = String(d.getDate()).padStart(2, '0');
    const y   = d.getFullYear();
    const dateLabel = fmt === 'US' ? `${mo}/${dy}` : fmt === 'EU' ? `${dy}/${mo}` : `${y}-${mo}-${dy}`;
    return `${dateLabel} · ${timeStr}`;
  }

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
    const bs = entry?.bodyStats || entry?.body_stats || {};
    const bsParts = [];
    if (bs.weight)   bsParts.push(`Weight: ${bs.weight}`);
    if (bs.body_fat) bsParts.push(`Body fat: ${bs.body_fat}%`);
    if (bsParts.length) statsText = bsParts.join(', ');

    // Water intake
    const waterMl   = (entry?.water || []).reduce((s, l) => s + (l.amount || 0), 0);
    const waterText  = waterMl > 0 ? `${(waterMl / 1000).toFixed(2)} L (${Math.round(waterMl)} ml)` : 'None logged';

    // Wellness data — Fitbit + Garmin + Withings, best-effort, silent on failure
    let wellnessText = '';
    try {
      const fitbitRes = await NtApi.get(`/api/wellness/fitbit/data?date=${today}`);
      const fd = fitbitRes[today];
      if (fd) {
        const parts = [];
        if (fd.steps != null)                parts.push(`Steps: ${Math.round(fd.steps).toLocaleString()}`);
        if (fd.active_minutes != null)        parts.push(`Active minutes: ${Math.round(fd.active_minutes)}`);
        if (fd.active_zone_minutes != null)   parts.push(`Active zone min: ${Math.round(fd.active_zone_minutes)}`);
        if (fd.calories_out != null)          parts.push(`Calories burned: ${Math.round(fd.calories_out)}`);
        if (fd.floors != null)                parts.push(`Floors: ${Math.round(fd.floors)}`);
        if (fd.distance_km != null)           parts.push(`Distance: ${fd.distance_km.toFixed(2)} km`);
        if (fd.sleep_duration_min != null)    { const h = Math.floor(fd.sleep_duration_min/60); parts.push(`Sleep: ${h}h ${Math.round(fd.sleep_duration_min%60)}m`); }
        if (fd.sleep_efficiency != null)      parts.push(`Sleep efficiency: ${fd.sleep_efficiency.toFixed(0)}%`);
        if (fd.sleep_score != null)           parts.push(`Sleep score: ${Math.round(fd.sleep_score)}/100`);
        if (fd.resting_hr != null)            parts.push(`Resting HR: ${Math.round(fd.resting_hr)} bpm`);
        if (fd.hrv_daily_rmssd != null)       parts.push(`HRV: ${fd.hrv_daily_rmssd.toFixed(1)} ms`);
        if (fd.spo2_avg != null)              parts.push(`SpO2: ${fd.spo2_avg.toFixed(1)}%`);
        if (fd.respiratory_rate != null)      parts.push(`Respiratory rate: ${fd.respiratory_rate.toFixed(1)} brpm`);
        if (fd.vo2_max != null)               parts.push(`Cardio fitness (VO2 Max): ${fd.vo2_max.toFixed(1)} mL/kg/min`);
        if (fd.skin_temp_variation != null) {
          const isFahr = $tempUnit !== 'C';
          const tv = isFahr ? fd.skin_temp_variation * 9 / 5 : fd.skin_temp_variation;
          parts.push(`Skin temp variation: ${tv >= 0 ? '+' : ''}${tv.toFixed(2)}${isFahr ? '°F' : '°C'}`);
        }
        if (fd.sleep_deep_min != null)       parts.push(`Deep sleep: ${Math.round(fd.sleep_deep_min)} min`);
        if (fd.sleep_light_min != null)      parts.push(`Light sleep: ${Math.round(fd.sleep_light_min)} min`);
        if (fd.sleep_rem_min != null)        parts.push(`REM sleep: ${Math.round(fd.sleep_rem_min)} min`);
        if (fd.sleep_wake_min != null)       parts.push(`Awake: ${Math.round(fd.sleep_wake_min)} min`);
        if (fd.readiness_score != null)     parts.push(`Daily readiness: ${Math.round(fd.readiness_score)}/100`);
        if (fd.stress_score != null)        parts.push(`Stress management: ${Math.round(fd.stress_score)}/100`);
        if (parts.length) wellnessText += `Fitbit: ${parts.join(', ')}`;
      }
    } catch {}
    // Workouts today
    try {
      const workouts = await NtApi.get(`/api/wellness/fitbit/workouts?date=${today}`);
      if (workouts?.length) {
        const wParts = workouts.map(w => {
          let s = w.activity_name;
          const details = [];
          if (w.duration_ms) details.push(`${Math.round(w.duration_ms/60000)} min`);
          if (w.distance_km) details.push(`${w.distance_km.toFixed(2)} km`);
          if (w.calories) details.push(`${w.calories} kcal`);
          if (w.avg_hr) details.push(`avg HR ${w.avg_hr} bpm`);
          if (w.max_hr) details.push(`max HR ${w.max_hr} bpm`);
          if (w.steps) details.push(`${w.steps.toLocaleString()} steps`);
          if (w.has_gps) details.push('GPS route recorded');
          if (details.length) s += ` (${details.join(', ')})`;
          return s;
        });
        wellnessText += (wellnessText ? '\n' : '') + `Workouts today: ${wParts.join('; ')}`;
      }
    } catch {}
    try {
      const garminRes = await NtApi.get(`/api/wellness/garmin/data?date=${today}`);
      const gd = garminRes[today];
      if (gd) {
        const parts = [];
        if (gd.steps != null)                parts.push(`Steps: ${Math.round(gd.steps).toLocaleString()}`);
        if (gd.active_minutes != null)        parts.push(`Active minutes: ${Math.round(gd.active_minutes)}`);
        if (gd.calories_out != null)          parts.push(`Calories burned: ${Math.round(gd.calories_out)}`);
        if (gd.distance_km != null)           parts.push(`Distance: ${gd.distance_km.toFixed(2)} km`);
        if (gd.sleep_duration_min != null)    { const h = Math.floor(gd.sleep_duration_min/60); parts.push(`Sleep: ${h}h ${Math.round(gd.sleep_duration_min%60)}m`); }
        if (gd.sleep_score != null)           parts.push(`Sleep score: ${Math.round(gd.sleep_score)}/100`);
        if (gd.resting_hr != null)            parts.push(`Resting HR: ${Math.round(gd.resting_hr)} bpm`);
        if (gd.hrv_daily_rmssd != null)       parts.push(`HRV: ${gd.hrv_daily_rmssd.toFixed(1)} ms`);
        if (gd.spo2_avg != null)              parts.push(`SpO2: ${gd.spo2_avg.toFixed(1)}%`);
        if (gd.body_battery_high != null)     parts.push(`Body battery peak: ${Math.round(gd.body_battery_high)}`);
        if (gd.body_battery_low != null)      parts.push(`Body battery low: ${Math.round(gd.body_battery_low)}`);
        if (gd.stress_avg != null)            parts.push(`Avg stress: ${Math.round(gd.stress_avg)}/100`);
        if (gd.max_hr != null)                parts.push(`Max HR: ${Math.round(gd.max_hr)} bpm`);
        if (gd.moderate_intensity_min != null) parts.push(`Moderate intensity: ${Math.round(gd.moderate_intensity_min)} min`);
        if (gd.vigorous_intensity_min != null) parts.push(`Vigorous intensity: ${Math.round(gd.vigorous_intensity_min)} min`);
        if (gd.sleep_deep_min != null)        parts.push(`Deep sleep: ${Math.round(gd.sleep_deep_min)} min`);
        if (gd.sleep_rem_min != null)         parts.push(`REM sleep: ${Math.round(gd.sleep_rem_min)} min`);
        if (gd.respiratory_rate != null)      parts.push(`Respiratory rate: ${gd.respiratory_rate.toFixed(1)} brpm`);
        if (parts.length) wellnessText += (wellnessText ? '\n' : '') + `Garmin: ${parts.join(', ')}`;
      }
    } catch {}
    try {
      const withingsRes = await NtApi.get(`/api/wellness/withings/data?date=${today}`);
      const wd = withingsRes[today];
      if (wd) {
        const parts = [];
        if (wd.weight_kg?.value != null)      parts.push(`Weight: ${wd.weight_kg.value.toFixed(1)} kg`);
        if (wd.body_fat_pct?.value != null)    parts.push(`Body fat: ${wd.body_fat_pct.value.toFixed(1)}%`);
        if (wd.muscle_mass_kg?.value != null)  parts.push(`Muscle mass: ${wd.muscle_mass_kg.value.toFixed(1)} kg`);
        if (wd.bone_mass_kg?.value != null)    parts.push(`Bone mass: ${wd.bone_mass_kg.value.toFixed(2)} kg`);
        if (wd.body_water_pct?.value != null)  parts.push(`Body water: ${wd.body_water_pct.value.toFixed(1)}%`);
        if (wd.visceral_fat?.value != null)    parts.push(`Visceral fat: ${wd.visceral_fat.value.toFixed(1)}`);
        if (wd.vascular_age?.value != null)    parts.push(`Vascular age: ${Math.round(wd.vascular_age.value)} yrs`);
        if (wd.metabolic_age?.value != null)   parts.push(`Metabolic age: ${Math.round(wd.metabolic_age.value)} yrs`);
        if (wd.lean_mass_kg?.value != null)   parts.push(`Lean mass: ${wd.lean_mass_kg.value.toFixed(1)} kg`);
        if (wd.fat_mass_kg?.value != null)    parts.push(`Fat mass: ${wd.fat_mass_kg.value.toFixed(1)} kg`);
        if (wd.basal_metabolic_rate?.value != null) parts.push(`BMR: ${Math.round(wd.basal_metabolic_rate.value)} kcal/day`);
        if (wd.nerve_health_score?.value != null) parts.push(`Nerve health: ${Math.round(wd.nerve_health_score.value)}`);
        if (wd.pulse_wave_velocity?.value != null) parts.push(`Pulse wave velocity: ${wd.pulse_wave_velocity.value.toFixed(1)} m/s`);
        if (wd.ecg_heart_rate?.value != null)  parts.push(`ECG HR: ${Math.round(wd.ecg_heart_rate.value)} bpm`);
        if (wd.ecg_afib?.value != null)        parts.push(`AFib: ${wd.ecg_afib.value === 1 ? 'Detected' : 'Normal'}`);
        if (parts.length) wellnessText += (wellnessText ? '\n' : '') + `Withings: ${parts.join(', ')}`;
      }
    } catch {}

    return { today, diaryText, goalsText, statsText, wellnessText, waterText };
  }

  function buildSystemPrompt(ctx) {
    const name = $aiAssistantName;
    return `You are ${name}, a friendly and knowledgeable AI nutrition and fitness coach built into NutriTrace. `
         + `You have full access to the user's health data: food diary, nutrition goals, body stats, water intake, `
         + `all wellness metrics from connected devices (Fitbit, Garmin, Withings), workout history with GPS routes, `
         + `daily readiness scores, and stress management scores. `
         + `You can discuss and provide insight on all of it — food choices, macros, sleep quality, activity, `
         + `heart health, recovery, hydration, body composition, workout performance, and more. `
         + `Be warm, encouraging, and concise. Give practical, evidence-based advice.\n\n`
         + `Current date: ${ctx.today}\n\n`
         + `TODAY'S FOOD LOG:\n${ctx.diaryText}\n`
         + `NUTRITION GOALS:\n${ctx.goalsText}\n\n`
         + `WATER INTAKE TODAY:\n${ctx.waterText}`
         + (ctx.statsText    ? `\n\nBODY STATS TODAY:\n${ctx.statsText}` : '')
         + (ctx.wellnessText ? `\n\nWELLNESS / FITNESS DATA TODAY:\n${ctx.wellnessText}`
                             : '\n\nWELLNESS DATA: No device data synced for today yet.');
  }

  function fmtTime() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function send() {
    const content = input.trim();
    if (!content && !attachedImage) return;
    if (loading) return;

    const key      = $aiApiKey;
    const provider = aiProvider.get() || 'claude';
    const model    = aiModel.get()    || undefined;

    if (!aiEnvLocked && !key) { showError('Add your API key in Settings → FitBot AI'); return; }

    const image = attachedImage;
    const userMsg = { role: 'user', content: content || '(image)', time: fmtTime(), image: image?.preview };
    messages = [...messages, userMsg];
    input    = '';
    attachedImage = null;
    loading  = true;
    await tick();
    _scrollBottom();

    // Persist user message to server (best-effort)
    NtApi.post('/api/ai/history', { role: 'user', content: content || '(image attached)' }).catch(() => {});

    try {
      const ctx          = await buildContext();
      const systemPrompt = buildSystemPrompt(ctx);
      // Build API messages — include image in the last user message if present
      const apiMessages  = messages
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-20);
      // If image attached, modify the last user message to include it
      if (image) {
        const lastIdx = apiMessages.length - 1;
        apiMessages[lastIdx] = _buildImageMessage(provider, content || 'What is this?', image);
      }
      const reply = aiEnvLocked
        ? await callAIProxy({ messages: apiMessages, systemPrompt })
        : await callAI({ provider, apiKey: key, model, messages: apiMessages, systemPrompt });
      messages = [...messages, { role: 'assistant', content: reply, time: fmtTime() }];
      // Persist assistant reply to server (best-effort)
      NtApi.post('/api/ai/history', { role: 'assistant', content: reply }).catch(() => {});
      if (!panelOpen) hasUnread = true;
    } catch (e) {
      showError(e.message || 'AI request failed');
    } finally {
      loading = false;
      await tick();
      _scrollBottom();
    }
  }

  function _buildImageMessage(provider, text, image) {
    if (provider === 'claude') {
      return { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
        { type: 'text', text },
      ]};
    } else if (provider === 'openai') {
      return { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        { type: 'text', text },
      ]};
    } else if (provider === 'gemini') {
      // Gemini handles images differently — pass through and let aiChat.js handle it
      return { role: 'user', content: text, _image: image };
    }
    return { role: 'user', content: text };
  }

  function _attachImage() {
    if (isNative) {
      import('@capacitor/camera').then(({ Camera, CameraResultType, CameraSource }) => {
        Camera.getPhoto({ quality: 80, resultType: CameraResultType.Base64, source: CameraSource.Prompt, width: 1024 })
          .then(photo => { attachedImage = { base64: photo.base64String, mimeType: `image/${photo.format || 'jpeg'}`, preview: `data:image/${photo.format || 'jpeg'};base64,${photo.base64String}` }; })
          .catch(() => {});
      });
    } else if (_hasCamera) {
      _showAttachMenu = !_showAttachMenu;
    } else {
      fileInput?.click();
    }
  }

  function _attachFromCamera() { _showAttachMenu = false; _cameraInput?.click(); }
  function _attachFromFile()   { _showAttachMenu = false; fileInput?.click(); }

  function _onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      attachedImage = { base64, mimeType: file.type, preview: dataUrl };
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function _removeImage() { attachedImage = null; }

  function _scrollBottom(instant = false) {
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function clearChat() {
    messages = [];
    localStorage.removeItem('wl:aiChatHistory');
    NtApi.del('/api/ai/history').catch(() => {});
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
            <div class="ai-header-sub">Your AI health & nutrition coach</div>
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
            <p class="ai-welcome-desc">Ask me anything — nutrition, sleep, activity, recovery, hydration, body composition. I have access to all your data from today.</p>
            <div class="ai-quick-chips">
              <button class="ai-chip" on:click={() => quickAsk("How am I doing today?")}>
                How am I doing today?
              </button>
              <button class="ai-chip" on:click={() => quickAsk("What should I eat for my next meal?")}>
                Meal suggestion
              </button>
              <button class="ai-chip" on:click={() => quickAsk("How was my sleep and recovery?")}>
                Sleep & recovery
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
                {#if msg.image}
                  <img src={msg.image} alt="Attached" class="ai-msg-image" />
                {/if}
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
      {#if attachedImage}
        <div class="ai-image-preview">
          <img src={attachedImage.preview} alt="Attached" />
          <button class="ai-image-remove" on:click={_removeImage}>
            <span class="material-symbols-rounded" style="font-size:16px">close</span>
          </button>
        </div>
      {/if}
      <div class="ai-input-bar">
        <div style="position:relative">
          <button class="ai-attach-btn" on:click={_attachImage} disabled={loading} title="Attach image">
            <span class="material-symbols-rounded">photo_camera</span>
          </button>
          {#if _showAttachMenu}
            <div class="ai-attach-menu">
              <button class="ai-attach-option" on:click={_attachFromCamera}>
                <span class="material-symbols-rounded" style="font-size:18px">photo_camera</span> Camera
              </button>
              <button class="ai-attach-option" on:click={_attachFromFile}>
                <span class="material-symbols-rounded" style="font-size:18px">photo_library</span> Gallery
              </button>
            </div>
          {/if}
        </div>
        <textarea
          class="ai-textarea"
          bind:value={input}
          placeholder="Ask me anything…"
          on:keydown={onKey}
          rows="1"
          disabled={loading}
        ></textarea>
        <button class="ai-send-btn" on:click={send} disabled={loading || (!input.trim() && !attachedImage)}>
          <span class="material-symbols-rounded">send</span>
        </button>
      </div>
      <input type="file" accept="image/*" bind:this={fileInput} on:change={_onFileSelected} style="display:none" />
      <input type="file" accept="image/*" capture="environment" bind:this={_cameraInput} on:change={_onFileSelected} style="display:none" />
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

  .ai-attach-btn {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: none;
    color: var(--text-3);
    border: 1px solid var(--border);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: color var(--dur-fast), border-color var(--dur-fast);
  }
  .ai-attach-btn:hover { color: var(--accent); border-color: var(--accent); }
  .ai-attach-btn:disabled { opacity: 0.4; cursor: default; }
  .ai-attach-btn .material-symbols-rounded { font-size: 20px; }

  .ai-attach-menu {
    position: absolute;
    bottom: 48px;
    left: 0;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    overflow: hidden;
    z-index: 10;
    min-width: 140px;
  }
  .ai-attach-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--text-1);
    font-size: 14px;
    cursor: pointer;
    text-align: left;
  }
  .ai-attach-option:hover { background: var(--surface-2); }
  .ai-attach-option + .ai-attach-option { border-top: 1px solid var(--border); }

  .ai-image-preview {
    position: relative;
    padding: 8px 16px 0;
    flex-shrink: 0;
  }
  .ai-image-preview img {
    max-height: 120px;
    max-width: 100%;
    border-radius: var(--radius-lg);
    object-fit: cover;
  }
  .ai-image-remove {
    position: absolute;
    top: 4px;
    right: 12px;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }

  .ai-msg-image {
    max-width: 200px;
    max-height: 150px;
    border-radius: var(--radius-lg);
    margin-bottom: 4px;
    object-fit: cover;
  }
</style>
