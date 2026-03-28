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

  <!--
    Silhouette layer — fork, apple, carrot, spoon.
    ViewBox 0 0 500 100 maps to the banner's full width/height.
    Silhouettes sit on the far left/right so the centre is clear for text.
  -->
  <svg class="tw-sil-svg" viewBox="0 0 500 100"
       preserveAspectRatio="xMidYMid slice" aria-hidden="true">

    <!-- ── Fork (far left, centred ≈ x42, y50) ─────────────────────── -->
    <g class="sil sf1">
      <!-- single outline path so tines, shoulder and handle read as one shape -->
      <path d="M38,82 L38,52 L34,44 L34,14 L36,14 L36,40 L39,40 L39,14
               L41,14 L41,40 L44,40 L44,14 L46,14 L46,44 L42,52 L42,82 Z"/>
    </g>

    <!-- ── Apple (left side, centred ≈ x125, y50) ──────────────────── -->
    <g class="sil sf2">
      <!-- body -->
      <path d="M125,28 C113,28 105,38 106,50 C107,63 115,73 125,73
               C135,73 143,63 144,50 C145,38 137,28 125,28 Z"/>
      <!-- stem -->
      <rect x="123.5" y="17" width="3" height="13" rx="1.5"
            transform="rotate(12,125,23)"/>
      <!-- leaf -->
      <path d="M126,23 C133,15 142,19 139,27 C134,29 127,27 126,23 Z"/>
    </g>

    <!-- ── Bell pepper (right side, centred ≈ x373, y50) ──────────────── -->
    <g class="sil sf3">
      <!-- stem -->
      <rect x="371" y="8" width="4" height="10" rx="2"/>
      <!-- left lobe -->
      <path d="M373,18 C360,18 355,26 356,38 C357,52 364,62 368,70
               C370,75 372,78 373,80 C374,78 376,75 378,70
               C382,62 389,52 390,38 C391,26 386,18 373,18 Z"/>
      <!-- left side bump -->
      <path d="M358,34 C352,34 350,40 352,46 C354,52 359,54 363,50
               C361,44 360,38 358,34 Z"/>
      <!-- right side bump -->
      <path d="M388,34 C394,34 396,40 394,46 C392,52 387,54 383,50
               C385,44 386,38 388,34 Z"/>
    </g>

    <!-- ── Spoon (far right, centred ≈ x458, y50) ──────────────────── -->
    <g class="sil sf4">
      <!-- single closed path: oval bowl widening from handle, tapering back -->
      <path d="M455,82 C452,82 451,80 451,77
               L451,52 C447,47 445,40 445,30
               C445,19 451,14 458,14
               C465,14 471,19 471,30
               C471,40 469,47 465,52
               L465,77 C465,80 464,82 461,82 Z"/>
    </g>

  </svg>

  <!-- Centre text content -->
  <div class="tw-inner">
    <div class="tw-decoration">
      <span class="tw-rule"></span>
      <span class="tw-diamond" class:no-anim={noAnim}>✦</span>
      <span class="tw-rule"></span>
    </div>
    <div class="tw-label">Today's Menu</div>
    <div class="tw-text">
      <span class="tw-typed" class:no-anim={noAnim}>{displayText}</span><span
        class="tw-cursor" class:no-anim={noAnim}>|</span>
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

  /* ── Silhouettes ─────────────────────────────────────────────────── */
  .tw-sil-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .sil {
    fill: var(--accent);
    opacity: 0.22;
    transform-box: fill-box;
    transform-origin: center;
  }

  .tw-banner:not(.no-anim) .sil {
    animation: sil-appear 0.7s cubic-bezier(0.34,1.2,0.64,1) both,
               sil-float  4s ease-in-out infinite;
  }
  /* stagger each silhouette's appear + float phase */
  .sf1 { animation-delay: 0.05s, 0.60s; animation-duration: 0.7s, 4.6s; }
  .sf2 { animation-delay: 0.15s, 0.70s; animation-duration: 0.7s, 3.9s; }
  .sf3 { animation-delay: 0.10s, 0.65s; animation-duration: 0.7s, 4.3s; }
  .sf4 { animation-delay: 0.20s, 0.75s; animation-duration: 0.7s, 5.0s; }

  @keyframes sil-appear {
    from { opacity: 0;    transform: translateY(10px) scale(0.9); }
    to   { opacity: 0.22; transform: translateY(0)    scale(1);   }
  }
  @keyframes sil-float {
    0%, 100% { transform: translateY(0);   }
    50%      { transform: translateY(-7px); }
  }

  /* ── Centre content ──────────────────────────────────────────────── */
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
    gap: 10px;
    opacity: 0.5;
  }
  .tw-rule {
    display: block;
    width: 48px;
    height: 1px;
    background: var(--accent);
  }
  .tw-banner:not(.no-anim) .tw-rule {
    animation: rule-breathe 3.5s ease-in-out infinite;
  }
  @keyframes rule-breathe {
    0%, 100% { width: 38px; opacity: 0.5; }
    50%      { width: 58px; opacity: 0.9; }
  }

  .tw-diamond {
    font-size: 10px;
    color: var(--accent);
    line-height: 1;
    display: inline-block;
  }
  .tw-banner:not(.no-anim) .tw-diamond:not(.no-anim) {
    animation: diamond-spin 7s linear infinite;
  }
  @keyframes diamond-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .tw-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0.6;
  }
  .tw-banner:not(.no-anim) .tw-label {
    animation: label-pulse 4s ease-in-out infinite;
  }
  @keyframes label-pulse {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 0.75; }
  }

  /* ── Typewriter text ─────────────────────────────────────────────── */
  .tw-text {
    font-size: 23px;
    font-weight: 700;
    letter-spacing: 0.01em;
    min-height: 1.4em;
    display: flex;
    align-items: center;
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 35%, transparent));
  }

  .tw-typed {
    background: linear-gradient(
      90deg,
      var(--accent) 0%,
      color-mix(in srgb, var(--accent) 65%, white) 50%,
      var(--accent) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .tw-banner:not(.no-anim) .tw-typed:not(.no-anim) {
    animation: shimmer 2.8s linear infinite;
  }
  .tw-typed.no-anim {
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
  }
  .tw-banner:not(.no-anim) .tw-cursor:not(.no-anim) {
    animation: blink 0.9s step-end infinite;
  }
  .tw-cursor.no-anim { opacity: 0; }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0; }
  }

  /* ── Reduced motion ───────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .sil        { animation: none !important; opacity: 0.22 !important; }
    .tw-rule,
    .tw-diamond,
    .tw-label,
    .tw-typed,
    .tw-cursor  { animation: none !important; }
    .tw-cursor  { opacity: 0; }
    .tw-typed   { -webkit-text-fill-color: var(--accent); background: none; opacity: 0.75; }
    .tw-text    { filter: none; }
  }
</style>
