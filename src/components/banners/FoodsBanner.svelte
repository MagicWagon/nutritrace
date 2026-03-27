<script>
  import { onMount, onDestroy } from 'svelte';
  import { DB } from '../../lib/db.js';

  let noAnim = DB.getSetting('disableAnimations', false);
  let noLoop = !DB.getSetting('loopBannerAnimations', true);
  if (typeof window !== 'undefined') {
    window.addEventListener('wl:setting', () => {
      noAnim = DB.getSetting('disableAnimations', false);
      noLoop = !DB.getSetting('loopBannerAnimations', true);
    });
  }

  const ITEMS = [
    'Grilled Chicken',
    'Pasta Carbonara',
    'Caesar Salad',
    'Beef Tacos',
    'Avocado Toast',
    'Chicken Stir Fry',
    'Mushroom Risotto',
    'Berry Smoothie Bowl',
  ];

  // Sparkle positions — fixed so they don't re-randomise on each render
  const SPARKLES = [
    { x:  8, y: 22, s: 7,  d: 0.0,  dur: 2.8 },
    { x: 18, y: 68, s: 5,  d: 0.7,  dur: 3.4 },
    { x: 32, y: 40, s: 9,  d: 1.4,  dur: 2.5 },
    { x: 50, y: 15, s: 6,  d: 0.3,  dur: 3.1 },
    { x: 65, y: 75, s: 8,  d: 1.9,  dur: 2.9 },
    { x: 74, y: 35, s: 5,  d: 0.9,  dur: 3.6 },
    { x: 83, y: 58, s: 7,  d: 2.2,  dur: 2.7 },
    { x: 92, y: 20, s: 6,  d: 0.5,  dur: 3.2 },
  ];

  let displayText = '';
  let itemIndex = 0;
  let charIndex = 0;
  let deleting = false;
  let timer;

  const TYPE_MS   = 75;
  const DEL_MS    = 38;
  const PAUSE_END = 1800;
  const PAUSE_GAP = 350;

  function tick() {
    const word = ITEMS[itemIndex];
    if (!deleting) {
      charIndex++;
      displayText = word.slice(0, charIndex);
      if (charIndex === word.length) {
        if (noLoop) return;
        timer = setTimeout(() => { deleting = true; tick(); }, PAUSE_END);
        return;
      }
      timer = setTimeout(tick, TYPE_MS);
    } else {
      charIndex--;
      displayText = word.slice(0, charIndex);
      if (charIndex === 0) {
        deleting = false;
        itemIndex = (itemIndex + 1) % ITEMS.length;
        timer = setTimeout(tick, PAUSE_GAP);
        return;
      }
      timer = setTimeout(tick, DEL_MS);
    }
  }

  onMount(() => {
    if (noAnim) { displayText = ITEMS[0]; return; }
    timer = setTimeout(tick, 500);
  });

  onDestroy(() => clearTimeout(timer));
</script>

<div class="tw-banner" class:no-anim={noAnim} aria-hidden="true">

  <!-- Sparkle layer -->
  {#if !noAnim}
    <svg class="tw-sparkles" viewBox="0 0 100 100" preserveAspectRatio="none">
      {#each SPARKLES as sp, i}
        <g class="sp sp{i}" style="--d:{sp.d}s; --dur:{sp.dur}s;">
          <!-- 4-point star -->
          <line x1={sp.x}       y1={sp.y - sp.s/2} x2={sp.x}       y2={sp.y + sp.s/2} stroke-width="0.8" stroke-linecap="round"/>
          <line x1={sp.x - sp.s/2} y1={sp.y}       x2={sp.x + sp.s/2} y2={sp.y}       stroke-width="0.8" stroke-linecap="round"/>
          <!-- diagonal arms (smaller) -->
          <line x1={sp.x - sp.s*0.28} y1={sp.y - sp.s*0.28} x2={sp.x + sp.s*0.28} y2={sp.y + sp.s*0.28} stroke-width="0.5" stroke-linecap="round"/>
          <line x1={sp.x + sp.s*0.28} y1={sp.y - sp.s*0.28} x2={sp.x - sp.s*0.28} y2={sp.y + sp.s*0.28} stroke-width="0.5" stroke-linecap="round"/>
        </g>
      {/each}
    </svg>
  {/if}

  <!-- Text content -->
  <div class="tw-inner">
    <div class="tw-decoration">
      <span class="tw-rule"></span>
      <span class="tw-diamond" class:no-anim={noAnim}>✦</span>
      <span class="tw-rule"></span>
    </div>
    <div class="tw-label">Today's Menu</div>
    <div class="tw-text">
      <span class="tw-typed" class:no-anim={noAnim}>{displayText}</span><span class="tw-cursor" class:no-anim={noAnim}>|</span>
    </div>
  </div>
</div>

<style>
  .tw-banner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    overflow: hidden;
  }

  /* ── Sparkle SVG ─────────────────────────────────────────────── */
  .tw-sparkles {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .tw-sparkles .sp line {
    stroke: var(--accent);
  }
  .tw-sparkles .sp {
    animation: sp-pulse var(--dur, 3s) ease-in-out var(--d, 0s) infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes sp-pulse {
    0%,100% { opacity: 0.12; transform: scale(0.8) translateY(0);  }
    50%      { opacity: 0.55; transform: scale(1.2) translateY(-3%); }
  }

  /* ── Decoration ──────────────────────────────────────────────── */
  .tw-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    position: relative;
    z-index: 1;
  }

  .tw-decoration {
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0.45;
  }
  .tw-rule {
    display: block;
    width: 44px;
    height: 1px;
    background: var(--accent);
    animation: rule-shimmer 3s ease-in-out infinite;
  }
  @keyframes rule-shimmer {
    0%,100% { opacity: 0.5; width: 36px; }
    50%      { opacity: 1.0; width: 52px; }
  }

  .tw-diamond {
    font-size: 9px;
    color: var(--accent);
    line-height: 1;
    animation: diamond-spin 6s linear infinite;
    display: inline-block;
  }
  .tw-diamond.no-anim { animation: none; }
  @keyframes diamond-spin {
    from { transform: rotate(0deg);   }
    to   { transform: rotate(360deg); }
  }

  .tw-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.20em;
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0.55;
    animation: label-fade 4s ease-in-out infinite;
  }
  @keyframes label-fade {
    0%,100% { opacity: 0.45; }
    50%      { opacity: 0.70; }
  }

  /* ── Typewriter text ─────────────────────────────────────────── */
  .tw-text {
    font-size: 23px;
    font-weight: 700;
    letter-spacing: 0.01em;
    min-height: 1.4em;
    display: flex;
    align-items: center;
    color: var(--accent);
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 40%, transparent));
  }

  .tw-typed {
    background: linear-gradient(
      90deg,
      var(--accent) 0%,
      color-mix(in srgb, var(--accent) 70%, white) 50%,
      var(--accent) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 2.8s linear infinite;
  }
  .tw-typed.no-anim {
    animation: none;
    background: none;
    -webkit-text-fill-color: var(--accent);
    color: var(--accent);
    opacity: 0.75;
  }
  @keyframes shimmer {
    0%   { background-position: 200% center; }
    100% { background-position:   0% center; }
  }

  .tw-cursor {
    display: inline-block;
    margin-left: 1px;
    color: var(--accent);
    -webkit-text-fill-color: var(--accent);
    font-weight: 200;
    animation: tw-blink 0.9s step-end infinite;
  }
  .tw-cursor.no-anim { animation: none; opacity: 0; }

  @keyframes tw-blink {
    0%,100% { opacity: 1; }
    50%      { opacity: 0; }
  }

  /* ── Disable all animations ──────────────────────────────────── */
  .tw-banner.no-anim .tw-rule,
  .tw-banner.no-anim .tw-label {
    animation: none;
  }
  .tw-banner.no-anim .tw-text {
    filter: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .tw-sparkles .sp,
    .tw-diamond,
    .tw-rule,
    .tw-label,
    .tw-typed,
    .tw-cursor { animation: none !important; }
    .tw-cursor { opacity: 0; }
    .tw-typed  { -webkit-text-fill-color: var(--accent); background: none; opacity: 0.75; }
    .tw-text   { filter: none; }
  }
</style>
