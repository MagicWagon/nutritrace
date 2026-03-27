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
  Foods page banner — floating place setting silhouettes.
  Each utensil is drawn as a filled silhouette path so it reads as the
  real object at banner scale: proper tines on the fork, a belly curve
  on the knife blade, a rounded bowl on the spoon, and rimmed plates.
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
    <radialGradient id="fb-glow" cx="50%" cy="50%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="500" height="120" fill="url(#fb-glow)"/>

  <!-- ── Plate 1 (left) centred at 80,60 ──────────────────────────────────── -->
  <g class="fb-item fbi1">
    <!-- Subtle plate fill -->
    <circle class="fb-plate-fill" cx="80" cy="60" r="27"/>
    <!-- Outer rim -->
    <circle class="fb-plate-rim-outer" cx="80" cy="60" r="27"/>
    <!-- Inner well ring -->
    <circle class="fb-plate-rim-inner" cx="80" cy="60" r="21"/>
  </g>

  <!-- ── Fork centred at x=186, tines start at y=12 ────────────────────────── -->
  <g class="fb-item fbi2">
    <!-- Tine 1 -->
    <rect class="fb-silhouette" x="177"   y="12" width="2.6" height="34" rx="1.3"/>
    <!-- Tine 2 -->
    <rect class="fb-silhouette" x="181.8" y="12" width="2.6" height="34" rx="1.3"/>
    <!-- Tine 3 -->
    <rect class="fb-silhouette" x="186.6" y="12" width="2.6" height="34" rx="1.3"/>
    <!-- Tine 4 -->
    <rect class="fb-silhouette" x="191.4" y="12" width="2.6" height="34" rx="1.3"/>
    <!-- Shoulder: tapers from tine-width (18 px) down to handle-width (10 px) -->
    <path class="fb-silhouette" d="M 175,44 L 182,54 L 194,54 L 201,44 Z"/>
    <!-- Handle -->
    <rect class="fb-silhouette" x="182" y="53" width="10" height="50" rx="5"/>
  </g>

  <!-- ── Knife centred around x=268, blade tip at y=12 ─────────────────────── -->
  <g class="fb-item fbi3">
    <!--
      Blade silhouette:
        left edge  = spine (straight)
        right edge = cutting edge with chef's-knife belly curve
      M 262,44   bottom-left (spine meets bolster)
      L 262,16   spine goes straight up
      Q 264,12 266,13  spine curves to a sharp tip
      Q 276,22 272,44  cutting-edge belly back down to heel
      Z
    -->
    <path class="fb-blade" d="M 262,44 L 262,16 Q 264,12 266,13 Q 276,22 272,44 Z"/>
    <!-- Bolster: slight width break between blade and handle -->
    <rect class="fb-silhouette" x="260" y="43" width="13" height="7" rx="2"/>
    <!-- Handle: slightly wider than bolster, rounded ends -->
    <rect class="fb-silhouette" x="260" y="49" width="12" height="50" rx="6"/>
  </g>

  <!-- ── Spoon centred at x=351, bowl top at y=10 ──────────────────────────── -->
  <g class="fb-item fbi4">
    <!--
      Bowl: filled ellipse — wider than the handle, clearly a spoon bowl.
      rx=12 ry=14 gives a slightly taller-than-wide oval, like a real spoon bowl.
    -->
    <ellipse class="fb-silhouette" cx="351" cy="26" rx="12" ry="15"/>
    <!-- Handle: connects from bottom of bowl, tapers slightly -->
    <rect class="fb-silhouette" x="347.5" y="37" width="7" height="60" rx="3.5"/>
  </g>

  <!-- ── Plate 2 (right) centred at 443,66 ─────────────────────────────────── -->
  <g class="fb-item fbi5">
    <circle class="fb-plate-fill"      cx="443" cy="66" r="23"/>
    <circle class="fb-plate-rim-outer" cx="443" cy="66" r="23"/>
    <circle class="fb-plate-rim-inner" cx="443" cy="66" r="18"/>
  </g>

  <!-- ── Sparkles (4-point star crosses) ──────────────────────────────────── -->
  <g class="fb-sparkle sp1">
    <line x1="138" y1="27" x2="138" y2="38" stroke-linecap="round"/>
    <line x1="132" y1="32" x2="144" y2="32" stroke-linecap="round"/>
  </g>
  <g class="fb-sparkle sp2">
    <line x1="315" y1="56" x2="315" y2="65" stroke-linecap="round"/>
    <line x1="310" y1="60" x2="320" y2="60" stroke-linecap="round"/>
  </g>
  <g class="fb-sparkle sp3">
    <line x1="408" y1="18" x2="408" y2="27" stroke-linecap="round"/>
    <line x1="403" y1="22" x2="413" y2="22" stroke-linecap="round"/>
  </g>
</svg>

<style>
  .foods-banner-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Plate styles ───────────────────────────────────────────────────────── */
  .fb-plate-fill {
    fill: var(--accent);
    opacity: 0.06;
  }
  .fb-plate-rim-outer {
    fill: none;
    stroke: var(--accent);
    stroke-opacity: 0.45;
    stroke-width: 2;
  }
  .fb-plate-rim-inner {
    fill: none;
    stroke: var(--accent);
    stroke-opacity: 0.28;
    stroke-width: 1.2;
  }

  /* ── Utensil silhouettes (filled) ───────────────────────────────────────── */
  .fb-silhouette {
    fill: var(--accent);
    opacity: 0.52;
  }

  /* Knife blade slightly more transparent so the profile reads clearly */
  .fb-blade {
    fill: var(--accent);
    opacity: 0.42;
  }

  /* ── Float animation ─────────────────────────────────────────────────────── */
  .fb-item {
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-appear 0.45s cubic-bezier(0.34, 1.3, 0.64, 1) both,
               fb-float  4s ease-in-out infinite;
  }
  /* appear delay, float delay */
  .fbi1 { animation-delay: 0.00s, 0.55s; animation-duration: 0.45s, 4.2s; }
  .fbi2 { animation-delay: 0.07s, 0.62s; animation-duration: 0.45s, 4.8s; }
  .fbi3 { animation-delay: 0.14s, 0.69s; animation-duration: 0.45s, 4.0s; }
  .fbi4 { animation-delay: 0.21s, 0.76s; animation-duration: 0.45s, 3.9s; }
  .fbi5 { animation-delay: 0.10s, 0.65s; animation-duration: 0.45s, 4.5s; }

  @keyframes fb-appear {
    from { opacity: 0; transform: scale(0.7) translateY(8px); }
    to   { opacity: 1; transform: scale(1)   translateY(0);   }
  }
  @keyframes fb-float {
    0%,100% { transform: translateY(0px);  }
    50%      { transform: translateY(-7px); }
  }

  /* ── Sparkles ────────────────────────────────────────────────────────────── */
  .fb-sparkle line {
    stroke: var(--accent);
    stroke-opacity: 0.30;
    stroke-width: 1.2;
  }
  .fb-sparkle {
    animation: fb-twinkle 2.5s ease-in-out infinite;
  }
  .sp1 { animation-delay: 0.0s;  animation-duration: 2.8s; }
  .sp2 { animation-delay: 0.9s;  animation-duration: 2.3s; }
  .sp3 { animation-delay: 1.6s;  animation-duration: 3.1s; }

  @keyframes fb-twinkle {
    0%,100% { opacity: 0.4; }
    50%      { opacity: 1.0; }
  }

  /* ── No-loop: ambient float plays once then stops ────────────────────────── */
  .foods-banner-svg.no-loop .fb-item {
    animation-name: fb-appear, fb-float-once;
    animation-iteration-count: 1, 1;
    animation-fill-mode: both, forwards;
  }
  .foods-banner-svg.no-loop .fb-sparkle {
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }
  @keyframes fb-float-once {
    0%   { transform: translateY(0px);  }
    50%  { transform: translateY(-7px); }
    100% { transform: translateY(0px);  }
  }

  /* ── Disable all animations ──────────────────────────────────────────────── */
  .foods-banner-svg.no-anim .fb-item,
  .foods-banner-svg.no-anim .fb-sparkle {
    animation: none;
    opacity: 1;
    transform: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .fb-item, .fb-sparkle {
      animation: none !important;
      opacity: 1   !important;
      transform: none !important;
    }
  }
</style>
