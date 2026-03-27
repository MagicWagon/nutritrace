<script>
  import { DB } from '../../lib/db.js';

  let noAnim = DB.getSetting('disableAnimations', false);
  let noLoop = !DB.getSetting('loopBannerAnimations', true);
  if (typeof window !== 'undefined') {
    window.addEventListener('wl:setting', () => {
      noAnim = DB.getSetting('disableAnimations', false);
      noLoop = !DB.getSetting('loopBannerAnimations', true);
    });
  }
</script>

<!--
  Foods page banner — ingredient scatter: circles of varying sizes connected
  by thin lines, like a nutritional breakdown or food-web map.
  Absolutely positioned behind the page-header content.
  All elements use var(--accent) at low opacity so it works with any theme.
-->
<svg
  class="foods-banner-svg"
  class:no-anim={noAnim}
  class:no-loop={noLoop}
  viewBox="0 0 500 120"
  preserveAspectRatio="xMidYMid slice"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <radialGradient id="fb-glow" cx="55%" cy="45%" r="50%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.18" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
    <radialGradient id="fb-node-grad" cx="35%" cy="30%" r="65%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.35" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.08" />
    </radialGradient>
  </defs>

  <!-- Ambient glow -->
  <rect x="0" y="0" width="500" height="120" fill="url(#fb-glow)" />

  <!-- Connecting lines (drawn first, behind nodes) -->
  <g class="fb-lines">
    <line class="fb-line fl1" x1="155" y1="28" x2="248" y2="48" />
    <line class="fb-line fl2" x1="248" y1="48" x2="338" y2="22" />
    <line class="fb-line fl3" x1="338" y1="22" x2="418" y2="48" />
    <line class="fb-line fl4" x1="418" y1="48" x2="338" y2="22" />
    <line class="fb-line fl5" x1="278" y1="78" x2="338" y2="22" />
    <line class="fb-line fl6" x1="278" y1="78" x2="418" y2="48" />
    <line class="fb-line fl7" x1="155" y1="28" x2="108" y2="58" />
    <line class="fb-line fl8" x1="108" y1="58" x2="278" y2="78" />
    <line class="fb-line fl9" x1="278" y1="78" x2="195" y2="95" />
    <line class="fb-line fl10" x1="418" y1="48" x2="468" y2="88" />
  </g>

  <!-- Ingredient nodes — large (proteins / main ingredients) -->
  <circle class="fb-node fn-lg fn1" cx="418" cy="48"  r="22" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-lg fn2" cx="155" cy="28"  r="19" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-lg fn3" cx="278" cy="78"  r="17" fill="url(#fb-node-grad)" />

  <!-- Ingredient nodes — medium (fruits / vegetables) -->
  <circle class="fb-node fn-md fn4" cx="338" cy="22"  r="13" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-md fn5" cx="108" cy="58"  r="11" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-md fn6" cx="468" cy="88"  r="12" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-md fn7" cx="195" cy="95"  r="10" fill="url(#fb-node-grad)" />

  <!-- Ingredient nodes — small (grains / spices) -->
  <circle class="fb-node fn-sm fn8"  cx="248" cy="48"  r="7" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-sm fn9"  cx="55"  cy="32"  r="6" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-sm fn10" cx="378" cy="88"  r="5" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-sm fn11" cx="60"  cy="100" r="5" fill="url(#fb-node-grad)" />
  <circle class="fb-node fn-sm fn12" cx="490" cy="28"  r="4" fill="url(#fb-node-grad)" />

  <!-- Pulse rings on the three large nodes (ambient loop) -->
  <circle class="fb-pulse fp1" cx="418" cy="48"  r="22" fill="none" />
  <circle class="fb-pulse fp2" cx="155" cy="28"  r="19" fill="none" />
  <circle class="fb-pulse fp3" cx="278" cy="78"  r="17" fill="none" />
</svg>

<style>
  .foods-banner-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Connecting lines ────────────────────────────────────────────────────── */
  .fb-line {
    stroke: var(--accent);
    stroke-opacity: 0.12;
    stroke-width: 0.8;
    stroke-dasharray: 180;
    stroke-dashoffset: 180;
    animation: fb-line-draw 0.5s ease both;
  }
  .fl1  { animation-delay: 0.40s; }
  .fl2  { animation-delay: 0.48s; }
  .fl3  { animation-delay: 0.52s; }
  .fl4  { animation-delay: 0.56s; }
  .fl5  { animation-delay: 0.60s; }
  .fl6  { animation-delay: 0.64s; }
  .fl7  { animation-delay: 0.44s; }
  .fl8  { animation-delay: 0.68s; }
  .fl9  { animation-delay: 0.72s; }
  .fl10 { animation-delay: 0.76s; }

  @keyframes fb-line-draw {
    to { stroke-dashoffset: 0; }
  }

  /* ── Nodes ───────────────────────────────────────────────────────────────── */
  .fb-node {
    stroke: var(--accent);
    stroke-opacity: 0.20;
    stroke-width: 1;
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-node-pop 0.45s cubic-bezier(0.34, 1.3, 0.64, 1) both;
  }
  /* Large nodes */
  .fn1 { animation-delay: 0.06s; }
  .fn2 { animation-delay: 0.00s; }
  .fn3 { animation-delay: 0.12s; }
  /* Medium nodes */
  .fn4 { animation-delay: 0.18s; }
  .fn5 { animation-delay: 0.24s; }
  .fn6 { animation-delay: 0.28s; }
  .fn7 { animation-delay: 0.32s; }
  /* Small nodes */
  .fn8  { animation-delay: 0.36s; }
  .fn9  { animation-delay: 0.20s; }
  .fn10 { animation-delay: 0.38s; }
  .fn11 { animation-delay: 0.42s; }
  .fn12 { animation-delay: 0.16s; }

  @keyframes fb-node-pop {
    from { transform: scale(0); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }

  /* ── Pulse rings (ambient loop on large nodes) ───────────────────────────── */
  .fb-pulse {
    stroke: var(--accent);
    stroke-width: 1;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-pulse-ring 3s ease-out infinite;
  }
  .fp1 { animation-delay: 0.0s;  animation-duration: 3.2s; }
  .fp2 { animation-delay: 1.1s;  animation-duration: 3.6s; }
  .fp3 { animation-delay: 2.0s;  animation-duration: 2.9s; }

  @keyframes fb-pulse-ring {
    0%   { transform: scale(1.0); opacity: 0.30; }
    100% { transform: scale(2.0); opacity: 0;    }
  }

  /* ── No-loop: pulse rings play once then stop ────────────────────────────── */
  .foods-banner-svg.no-loop .fb-pulse {
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }

  /* ── Disable all animations ──────────────────────────────────────────────── */
  .foods-banner-svg.no-anim .fb-line,
  .foods-banner-svg.no-anim .fb-node,
  .foods-banner-svg.no-anim .fb-pulse {
    animation: none;
    transform: none;
    opacity: 1;
  }
  .foods-banner-svg.no-anim .fb-line  { stroke-dashoffset: 0; opacity: 1; }
  .foods-banner-svg.no-anim .fb-pulse { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    .fb-line  { animation: none !important; stroke-dashoffset: 0 !important; }
    .fb-node  { animation: none !important; opacity: 1 !important; transform: none !important; }
    .fb-pulse { animation: none !important; opacity: 0 !important; }
  }
</style>
