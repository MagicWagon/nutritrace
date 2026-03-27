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
  Foods page banner — floating place setting: fork, knife, spoon, and plate.
  All elements are realistic, recognizable utensil/dishware shapes.
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
    <radialGradient id="fb-glow" cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.16" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
  </defs>

  <!-- Ambient glow -->
  <rect x="0" y="0" width="500" height="120" fill="url(#fb-glow)" />

  <!-- Plate 1 (left) -->
  <g class="fb-item fbi1">
    <circle class="fb-plate" cx="80" cy="50" r="22" fill="none" stroke-width="1.8" />
    <circle class="fb-plate-rim" cx="80" cy="50" r="16" fill="none" stroke-width="0.9" />
  </g>

  <!-- Fork (upper right) -->
  <g class="fb-item fbi2">
    <line class="fb-utensil" x1="380" y1="85" x2="380" y2="15" stroke-width="2.2" stroke-linecap="round" />
    <!-- Tines -->
    <line class="fb-tine" x1="365" y1="15" x2="365" y2="30" stroke-width="1.4" stroke-linecap="round" />
    <line class="fb-tine" x1="373" y1="15" x2="373" y2="30" stroke-width="1.4" stroke-linecap="round" />
    <line class="fb-tine" x1="381" y1="15" x2="381" y2="30" stroke-width="1.4" stroke-linecap="round" />
    <line class="fb-tine" x1="389" y1="15" x2="389" y2="30" stroke-width="1.4" stroke-linecap="round" />
    <!-- Tine connector -->
    <line class="fb-utensil-conn" x1="363" y1="32" x2="391" y2="32" stroke-width="1" stroke-linecap="round" />
  </g>

  <!-- Knife (center-right) -->
  <g class="fb-item fbi3">
    <line class="fb-utensil" x1="280" y1="90" x2="280" y2="18" stroke-width="2.4" stroke-linecap="round" />
    <!-- Blade -->
    <path class="fb-blade" d="M 280,18 L 292,35 L 280,40 Z" />
  </g>

  <!-- Spoon (left-center) -->
  <g class="fb-item fbi4">
    <line class="fb-utensil" x1="180" y1="88" x2="180" y2="38" stroke-width="2" stroke-linecap="round" />
    <!-- Bowl -->
    <ellipse class="fb-spoon-bowl" cx="180" cy="25" rx="13" ry="16" fill="none" stroke-width="1.6" />
  </g>

  <!-- Plate 2 (right) -->
  <g class="fb-item fbi5">
    <circle class="fb-plate" cx="440" cy="70" r="20" fill="none" stroke-width="1.6" />
    <circle class="fb-plate-rim" cx="440" cy="70" r="14" fill="none" stroke-width="0.8" />
  </g>

  <!-- Sparkles -->
  <g class="fb-sparkles">
    <!-- 4-point star sparkle 1 -->
    <line class="fb-sparkle sp1" x1="120" y1="25" x2="120" y2="35" stroke-width="1" stroke-linecap="round" />
    <line class="fb-sparkle sp1" x1="115" y1="30" x2="125" y2="30" stroke-width="1" stroke-linecap="round" />

    <!-- 4-point star sparkle 2 -->
    <line class="fb-sparkle sp2" x1="320" y1="55" x2="320" y2="63" stroke-width="0.8" stroke-linecap="round" />
    <line class="fb-sparkle sp2" x1="316" y1="59" x2="324" y2="59" stroke-width="0.8" stroke-linecap="round" />

    <!-- 4-point star sparkle 3 -->
    <line class="fb-sparkle sp3" x1="420" y1="15" x2="420" y2="24" stroke-width="0.9" stroke-linecap="round" />
    <line class="fb-sparkle sp3" x1="415.5" y1="19.5" x2="424.5" y2="19.5" stroke-width="0.9" stroke-linecap="round" />
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

  /* ── Utensil base styling ───────────────────────────────────────────────── */
  .fb-utensil {
    stroke: var(--accent);
    stroke-opacity: 0.65;
  }
  .fb-utensil-conn {
    stroke: var(--accent);
    stroke-opacity: 0.65;
  }
  .fb-tine {
    stroke: var(--accent);
    stroke-opacity: 0.65;
  }
  .fb-plate {
    stroke: var(--accent);
    stroke-opacity: 0.40;
  }
  .fb-plate-rim {
    stroke: var(--accent);
    stroke-opacity: 0.25;
  }
  .fb-spoon-bowl {
    stroke: var(--accent);
    stroke-opacity: 0.65;
  }
  .fb-blade {
    fill: var(--accent);
    opacity: 0.35;
  }

  /* ── Floating items ────────────────────────────────────────────────────── */
  .fb-item {
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-float 4s ease-in-out infinite;
  }
  .fbi1 { animation-delay: 0.0s;  animation-duration: 4.2s; }
  .fbi2 { animation-delay: 0.8s;  animation-duration: 4.8s; }
  .fbi3 { animation-delay: 0.4s;  animation-duration: 4.0s; }
  .fbi4 { animation-delay: 1.2s;  animation-duration: 3.9s; }
  .fbi5 { animation-delay: 0.6s;  animation-duration: 4.5s; }

  @keyframes fb-float {
    0%, 100% {
      transform: translateY(0px) rotateZ(0deg);
    }
    50% {
      transform: translateY(-8px) rotateZ(3deg);
    }
  }

  /* ── Sparkles ──────────────────────────────────────────────────────────── */
  .fb-sparkle {
    stroke: var(--accent);
    opacity: 0.15;
    animation: fb-sparkle-twinkle 2.5s ease-in-out infinite;
  }
  .sp1 { animation-delay: 0.0s;  animation-duration: 2.8s; }
  .sp2 { animation-delay: 0.9s;  animation-duration: 2.3s; }
  .sp3 { animation-delay: 1.6s;  animation-duration: 3.1s; }

  @keyframes fb-sparkle-twinkle {
    0%, 100% { opacity: 0.08; }
    50%       { opacity: 0.25; }
  }

  /* ── No-loop: items and sparkles play once then stop ───────────────────── */
  .foods-banner-svg.no-loop .fb-item,
  .foods-banner-svg.no-loop .fb-sparkle {
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }

  /* ── Disable all animations ──────────────────────────────────────────────── */
  .foods-banner-svg.no-anim .fb-item,
  .foods-banner-svg.no-anim .fb-sparkle {
    animation: none;
    transform: none;
    opacity: 1;
  }
  .foods-banner-svg.no-anim .fb-sparkle {
    opacity: 0.15;
  }
  @media (prefers-reduced-motion: reduce) {
    .fb-item, .fb-sparkle {
      animation: none !important;
      transform: none !important;
    }
  }
</style>
