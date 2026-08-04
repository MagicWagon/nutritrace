<script>
  import { _ } from 'svelte-i18n';
  import Toggle from '../../components/settings/Toggle.svelte';
  import { DB } from '../../lib/db.js';
  import { mealIcon } from '../../lib/mealIcon.js';
  import {
    mealNames,
    diaryShowBrands, diaryShowTimestamps, diaryShowThumbnails, diaryShowAllNutrients,
    diaryShowNutritionUnits, diaryShowMacroSummary, diaryPromptQuantity,
    diaryShowPortionSize, warnUnitMismatch, showUnitMetadata, diaryShowNotes,
    diaryShowActivity, manualActivityPolicy, calorieAdjustFromActivity,
    showQuickCalories, quickCaloriesDisplay,
    diaryShowNutritionBar,
    healthConnectEnabled,
    fastingEnabled, fastingDefaultHours, fastingNotifyOnGoal,
    fastingScheduleEnabled, fastingScheduleTime, fastingScheduleDays, fastingScheduleGoal,
  } from '../../stores/settings.js';
  import { isNative, getServerUrl } from '../../lib/platform.js';

  // Same rule the parent shell derives.
  $: isNativeLocal = isNative && !getServerUrl();

  // ── Meal names ─────────────────────────────────────────────────────────────
  let meals = [...(DB.getSetting('mealNames', ['Breakfast','Lunch','Dinner','Snacks']))];

  function autoSaveMeals() {
    const toSave = meals.filter(m => m.trim());
    if (toSave.length) mealNames.set(toSave);
  }

  // Drag-to-reorder for meal names
  let mealDragFrom = null, mealDragOver = null, mealDragDelta = 0, mealRowHeights = [];
  function onMealDragDown(e, i) {
    const list = e.currentTarget.closest('.drag-list');
    const rows = [...list.querySelectorAll('.drag-row')];
    mealRowHeights = rows.map(r => r.getBoundingClientRect().height);
    mealDragFrom = i; mealDragOver = i; mealDragDelta = 0;
    list.setPointerCapture(e.pointerId);
    list._dragStartY = e.clientY;
  }
  function onMealDragMove(e) {
    if (mealDragFrom === null) return;
    mealDragDelta = e.clientY - e.currentTarget._dragStartY;
    const rows = [...e.currentTarget.querySelectorAll('.drag-row')];
    const y = e.clientY;
    let best = mealDragOver;
    for (let idx = 0; idx < rows.length; idx++) {
      if (idx === mealDragFrom) continue;
      const r = rows[idx].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { best = idx; break; }
    }
    mealDragOver = best;
  }
  function onMealDragUp() {
    if (mealDragFrom !== null && mealDragOver !== null && mealDragFrom !== mealDragOver) {
      const reordered = [...meals];
      const [removed] = reordered.splice(mealDragFrom, 1);
      reordered.splice(mealDragOver, 0, removed);
      meals = reordered;
      autoSaveMeals();
    }
    mealDragFrom = null; mealDragOver = null; mealDragDelta = 0; mealRowHeights = [];
  }

  function dragShift(i, from, over, heights) {
    if (from === null || over === null || i === from || from === over) return 0;
    const h = heights[from] || 52;
    if (from < over && i > from && i <= over) return -h;
    if (from > over && i >= over && i < from) return h;
    return 0;
  }
</script>

<div class="section-body">
  <div class="card settings-card">
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_brand')}</span><div class="setting-desc">{$_('settings_diary.show_brand_desc')}</div></div>
      <Toggle checked={$diaryShowBrands} on:change={e => diaryShowBrands.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_timestamps')}</span><div class="setting-desc">{$_('settings_diary.show_timestamps_desc')}</div></div>
      <Toggle checked={$diaryShowTimestamps} on:change={e => diaryShowTimestamps.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_thumbnails')}</span><div class="setting-desc">{$_('settings_diary.show_thumbnails_desc')}</div></div>
      <Toggle checked={$diaryShowThumbnails} on:change={e => diaryShowThumbnails.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_all_nutrients')}</span><div class="setting-desc">{$_('settings_diary.show_all_nutrients_desc')}</div></div>
      <Toggle checked={$diaryShowAllNutrients} on:change={e => diaryShowAllNutrients.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_units')}</span><div class="setting-desc">{$_('settings_diary.show_units_desc')}</div></div>
      <Toggle checked={$diaryShowNutritionUnits} on:change={e => diaryShowNutritionUnits.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_macro_summary')}</span><div class="setting-desc">{$_('settings_diary.show_macro_summary_desc')}</div></div>
      <Toggle checked={$diaryShowMacroSummary} on:change={e => diaryShowMacroSummary.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.ask_quantity')}</span><div class="setting-desc">{$_('settings_diary.ask_quantity_desc')}</div></div>
      <Toggle checked={$diaryPromptQuantity} on:change={e => diaryPromptQuantity.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <!-- Issues #69 + #70: master toggle for the nutrition basis,
         serving units, and density fields. Default off so users
         who don't need the extra fields aren't distracted by them.
         Auto-on for anyone who turned on Warn About Unit
         Conversions below (the natural signal of intent). -->
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.unit_metadata')}</span><div class="setting-desc">{$_('settings_diary.unit_metadata_desc')}</div></div>
      <Toggle checked={$showUnitMetadata} on:change={e => showUnitMetadata.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <!-- Sub-feature of Show Unit Metadata. Default off so users
         who weigh everything in grams aren't nagged on Open Food
         Facts per-100-ml drinks. Turning this on also implicitly
         enables Show Unit Metadata at the call sites via the
         reactive gate `$showUnitMetadata || $warnUnitMismatch`. -->
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.warn_conversions')}</span><div class="setting-desc">{$_('settings_diary.warn_conversions_desc')}</div></div>
      <Toggle checked={$warnUnitMismatch} on:change={e => warnUnitMismatch.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_portion')}</span><div class="setting-desc">{$_('settings_diary.show_portion_desc')}</div></div>
      <Toggle checked={$diaryShowPortionSize} on:change={e => diaryShowPortionSize.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_daily_notes')}</span><div class="setting-desc">{$_('settings_diary.show_daily_notes_desc')}</div></div>
      <Toggle checked={$diaryShowNotes} on:change={e => diaryShowNotes.set(e.detail)} />
    </div>
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_quick_cals')}</span><div class="setting-desc">{$_('settings_diary.show_quick_cals_desc')}</div></div>
      <Toggle checked={$showQuickCalories} on:change={e => showQuickCalories.set(e.detail)} />
    </div>
    {#if $showQuickCalories}
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div><span class="setting-label">{$_('settings_diary.quick_cals_display')}</span><div class="setting-desc">{$_('settings_diary.quick_cals_display_desc')}</div></div>
        <div class="select-wrap" style="width:130px">
          <select class="select sel-sm" value={$quickCaloriesDisplay} on:change={e => quickCaloriesDisplay.set(e.currentTarget.value)}>
            <option value="summed">{$_('settings_diary.opt_summed')}</option>
            <option value="separate">{$_('settings_diary.opt_separate')}</option>
          </select>
        </div>
      </div>
    {/if}
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_activity')}</span><div class="setting-desc">{$_('settings_diary.show_activity_desc')}</div></div>
      <Toggle checked={$diaryShowActivity} on:change={e => diaryShowActivity.set(e.detail)} />
    </div>
    {#if $diaryShowActivity}
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div><span class="setting-label">{$_('settings_diary.adjust_calorie_goal')}</span><div class="setting-desc">{$_('settings_diary.adjust_calorie_goal_desc')}</div></div>
        <Toggle checked={$calorieAdjustFromActivity} on:change={e => calorieAdjustFromActivity.set(e.detail)} />
      </div>
    {/if}
    {#if $diaryShowActivity && $calorieAdjustFromActivity && (!isNativeLocal || $healthConnectEnabled)}
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div style="flex:1">
          <span class="setting-label">When Wearable + Manual Entries Both Exist</span>
          <div class="setting-desc">{isNativeLocal ? 'How to combine your manually-logged activity with Health Connect active calories on days you have both.' : 'How to combine your manually-logged activity with calories from Fitbit / Garmin / Withings / Health Connect on days you have both.'}</div>
          <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
            <label style="display:flex; gap:8px; align-items:flex-start;">
              <input type="radio" name="activityPolicy" value="wearable_wins" checked={$manualActivityPolicy === 'wearable_wins'} on:change={() => manualActivityPolicy.set('wearable_wins')} />
              <span><strong>{$_('settings_diary.policy_wearable_wins')}</strong> <span class="setting-desc">{$_('settings_diary.policy_wearable_desc')}</span></span>
            </label>
            <label style="display:flex; gap:8px; align-items:flex-start;">
              <input type="radio" name="activityPolicy" value="manual_wins" checked={$manualActivityPolicy === 'manual_wins'} on:change={() => manualActivityPolicy.set('manual_wins')} />
              <span><strong>{$_('settings_diary.policy_manual_wins')}</strong> <span class="setting-desc">{$_('settings_diary.policy_manual_desc')}</span></span>
            </label>
            <label style="display:flex; gap:8px; align-items:flex-start;">
              <input type="radio" name="activityPolicy" value="additive" checked={$manualActivityPolicy === 'additive'} on:change={() => manualActivityPolicy.set('additive')} />
              <span><strong>{$_('settings_diary.policy_add')}</strong> <span class="setting-desc">{$_('settings_diary.policy_add_desc')}</span></span>
            </label>
          </div>
          <div class="setting-desc" style="margin-top:8px">When no wearable data exists for a day, manual entries always count regardless of this setting.</div>
        </div>
      </div>
    {/if}
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_fasting')}</span><div class="setting-desc">{$_('settings_diary.show_fasting_desc')}</div></div>
      <Toggle checked={$fastingEnabled} on:change={e => fastingEnabled.set(e.detail)} />
    </div>
    {#if $fastingEnabled}
      <div class="setting-divider"></div>
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <span class="setting-label">{$_('settings_diary.default_fast_goal')}</span>
        <div class="seg-control" style="width:100%;--seg-count:5;--seg-active:{[14,16,18,20,23].indexOf($fastingDefaultHours)}">
          {#each [14,16,18,20,23] as h}
            <button class="seg-opt" class:seg-active={$fastingDefaultHours === h}
              on:click={() => fastingDefaultHours.set(h)}>
              {h === 23 ? 'OMAD' : `${h}:${24 - h}`}
            </button>
          {/each}
        </div>
      </div>
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div><span class="setting-label">{$_('settings_diary.notify_goal')}</span><div class="setting-desc">{$_('settings_diary.notify_goal_desc')}</div></div>
        <Toggle checked={$fastingNotifyOnGoal} on:change={e => fastingNotifyOnGoal.set(e.detail)} />
      </div>

      <div class="setting-divider"></div>
      <div class="setting-row">
        <div>
          <span class="setting-label">{$_('settings_diary.recurring_schedule')}</span>
          <div class="setting-desc">Auto-start a fast at a fixed time each day. The schedule fires once per scheduled day; manually started fasts still work normally.</div>
        </div>
        <Toggle checked={$fastingScheduleEnabled} on:change={e => fastingScheduleEnabled.set(e.detail)} />
      </div>
      {#if $fastingScheduleEnabled}
        <div class="setting-divider"></div>
        <div class="setting-row">
          <span class="setting-label">{$_('settings_diary.start_time')}</span>
          <input class="input" type="time" style="width:120px;text-align:center"
            value={$fastingScheduleTime}
            on:change={e => fastingScheduleTime.set(e.target.value)} />
        </div>
        <div class="setting-divider"></div>
        <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
          <span class="setting-label">{$_('settings_diary.repeat_on')}</span>
          <div class="seg-control multi" style="width:100%;--seg-count:7">
            {#each ['S','M','T','W','T','F','S'] as label, idx}
              <button class="seg-opt" type="button"
                class:seg-active={$fastingScheduleDays?.includes(idx)}
                on:click={() => {
                  const cur = $fastingScheduleDays || [];
                  const next = cur.includes(idx) ? cur.filter(d => d !== idx) : [...cur, idx].sort((a,b)=>a-b);
                  fastingScheduleDays.set(next);
                }}>{label}</button>
            {/each}
          </div>
          <div class="setting-desc" style="margin:0">
            Tap a day to toggle. Sunday → Saturday.
          </div>
        </div>
        <div class="setting-divider"></div>
        <div class="setting-row">
          <span class="setting-label">{$_('settings_diary.schedule_goal')}</span>
          <input class="input" type="number" min="1" max="168" step="0.5"
            style="width:90px;text-align:center"
            value={$fastingScheduleGoal}
            on:change={e => fastingScheduleGoal.set(Number(e.target.value) || 16)} />
        </div>
      {/if}
    {/if}
    <div class="setting-divider"></div>
    <div class="setting-row">
      <div><span class="setting-label">{$_('settings_diary.show_progress_bar')}</span><div class="setting-desc">{$_('settings_diary.show_progress_bar_desc')}</div></div>
      <Toggle checked={$diaryShowNutritionBar} on:change={e => diaryShowNutritionBar.set(e.detail)} />
    </div>
  </div>

  <p class="sub-label">{$_('settings_diary.meal_names')}</p>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="card settings-card drag-list"
    on:pointermove={onMealDragMove}
    on:pointerup={onMealDragUp}
    on:pointercancel={onMealDragUp}>
    {#each meals as _m, i}
      {#if i > 0}<div class="setting-divider"></div>{/if}
      <div class="setting-row drag-row"
        class:dragging={mealDragFrom === i}
        class:drag-target={mealDragFrom !== null && mealDragFrom !== i && mealDragOver === i}
        style={mealDragFrom !== null
          ? mealDragFrom === i
            ? `transform:scale(1.04) translateY(${mealDragDelta}px);transition:box-shadow 200ms ease,opacity 200ms ease`
            : `transform:translateY(${dragShift(i,mealDragFrom,mealDragOver,mealRowHeights)}px)`
          : ''}>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span class="drag-handle material-symbols-rounded" on:pointerdown={e => onMealDragDown(e, i)}>drag_indicator</span>
        <span class="material-symbols-rounded" style="font-size:18px;color:var(--text-3);flex-shrink:0">{mealIcon(meals[i])}</span>
        <input class="input" style="flex:1;height:36px;min-width:0" placeholder={$_('settings_main_deep.meal_placeholder', { values: { n: i+1 } })} bind:value={meals[i]} on:blur={autoSaveMeals} />
        {#if meals.length > 1}
          <button class="btn-icon" style="width:32px;height:32px;color:var(--danger);flex-shrink:0"
            on:click={() => { meals = meals.filter((_,j) => j !== i); autoSaveMeals(); }} title="Remove meal">
            <span class="material-symbols-rounded" style="font-size:16px">remove</span>
          </button>
        {/if}
      </div>
    {/each}
    <div style="padding:8px 16px 14px">
      <button class="btn btn-secondary" style="height:36px;font-size:13px;width:100%;display:flex;align-items:center;justify-content:center;gap:4px"
        on:click={() => meals = [...meals.filter(m => m.trim()), '']}>
        <span class="material-symbols-rounded" style="font-size:16px">add</span> Add Meal
      </button>
    </div>
  </div>
</div>
