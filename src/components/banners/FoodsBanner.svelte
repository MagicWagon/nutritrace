<script>
  import { DB } from '../../lib/db.js';

  let noAnim = DB.getSetting('disableAnimations', false);
  if (typeof window !== 'undefined') {
    window.addEventListener('wl:setting', () => {
      noAnim = DB.getSetting('disableAnimations', false);
    });
  }
</script>

<!--
  Foods page banner — vine stem with leaves, produce circles, and sparkle diamonds.
  Absolutely positioned behind the page-header content.
  All elements use var(--accent) at low opacity so it works with any theme.
-->
<svg
  class="foods-banner-svg"
  class:no-anim={noAnim}
  viewBox="0 0 500 120"
  preserveAspectRatio="xMidYMid slice"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <radialGradient id="fb-glow" cx="30%" cy="60%" r="45%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.20" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"    />
    </radialGradient>
    <radialGradient id="fb-produce-grad" cx="35%" cy="35%" r="65%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.28" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.08" />
    </radialGradient>
  </defs>

  <!-- Ambient glow -->
  <rect x="0" y="0" width="500" height="120" fill="url(#fb-glow)" />

  <!-- Main vine stem — sweeping S-curve across the banner -->
  <path
    class="fb-vine"
    d="M -10,100 C 40,80 80,30 140,55
       C 200,80 240,20 310,45
       C 380,70 430,25 510,40"
    fill="none"
  />

  <!-- Secondary vine tendril -->
  <path
    class="fb-vine fb-vine-2"
    d="M 60,110 C 80,90 100,70 130,60"
    fill="none"
  />
  <path
    class="fb-vine fb-vine-2"
    d="M 290,55 C 310,35 340,28 360,38"
    fill="none"
  />

  <!-- Leaves (ellipses rotated along the vine) -->
  <ellipse class="fb-leaf fl1" cx="90"  cy="42"  rx="18" ry="9"  transform="rotate(-35, 90, 42)"  />
  <ellipse class="fb-leaf fl2" cx="175" cy="68"  rx="16" ry="8"  transform="rotate(25, 175, 68)"  />
  <ellipse class="fb-leaf fl3" cx="255" cy="32"  rx="20" ry="9"  transform="rotate(-50, 255, 32)" />
  <ellipse class="fb-leaf fl4" cx="345" cy="58"  rx="17" ry="8"  transform="rotate(30, 345, 58)"  />
  <ellipse class="fb-leaf fl5" cx="430" cy="30"  rx="15" ry="7"  transform="rotate(-40, 430, 30)" />
  <!-- Small accent leaves -->
  <ellipse class="fb-leaf fl6" cx="130" cy="60"  rx="11" ry="5"  transform="rotate(15, 130, 60)"  />
  <ellipse class="fb-leaf fl7" cx="390" cy="42"  rx="12" ry="5"  transform="rotate(-20, 390, 42)" />

  <!-- Produce circles (stylized: tomato, orange, apple silhouettes) -->
  <circle class="fb-produce fp1" cx="50"  cy="82" r="16" fill="url(#fb-produce-grad)" />
  <circle class="fb-produce fp2" cx="220" cy="90" r="19" fill="url(#fb-produce-grad)" />
  <circle class="fb-produce fp3" cx="380" cy="78" r="15" fill="url(#fb-produce-grad)" />
  <circle class="fb-produce fp4" cx="460" cy="95" r="13" fill="url(#fb-produce-grad)" />
  <!-- Tiny stem on produce circles -->
  <line class="fb-stem"  x1="50"  y1="66" x2="50"  y2="59" />
  <line class="fb-stem"  x1="220" y1="71" x2="222" y2="64" />
  <line class="fb-stem"  x1="380" y1="63" x2="381" y2="57" />

  <!-- 4-point sparkle diamonds -->
  <path class="fb-sparkle fs1" d="M 155,20 L 158,27 L 155,34 L 152,27 Z" />
  <path class="fb-sparkle fs2" d="M 310,15 L 313,23 L 310,31 L 307,23 Z" />
  <path class="fb-sparkle fs3" d="M 470,55 L 473,62 L 470,69 L 467,62 Z" />
  <path class="fb-sparkle fs4" d="M 20,50  L 23,57  L 20,64  L 17,57  Z" />
</svg>

<style>
  .foods-banner-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Vine stem ───────────────────────────────────────────────────────────── */
  .fb-vine {
    stroke: var(--accent);
    stroke-opacity: 0.22;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-dasharray: 800;
    stroke-dashoffset: 800;
    animation: fb-vine-draw 1.0s cubic-bezier(0.4, 0, 0.2, 1) 0.0s both;
  }
  .fb-vine-2 {
    stroke-width: 1.2;
    stroke-dasharray: 120;
    stroke-dashoffset: 120;
    animation-duration: 0.5s;
    animation-delay: 0.6s;
  }
  @keyframes fb-vine-draw {
    to { stroke-dashoffset: 0; }
  }

  /* ── Leaves ──────────────────────────────────────────────────────────────── */
  .fb-leaf {
    fill: var(--accent);
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-leaf-pop 0.4s cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }
  .fl1 { animation-delay: 0.20s; }
  .fl2 { animation-delay: 0.35s; }
  .fl3 { animation-delay: 0.28s; }
  .fl4 { animation-delay: 0.45s; }
  .fl5 { animation-delay: 0.38s; }
  .fl6 { animation-delay: 0.55s; }
  .fl7 { animation-delay: 0.50s; }

  @keyframes fb-leaf-pop {
    from { opacity: 0; transform: scale(0); }
    to   { opacity: 0.18; transform: scale(1); }
  }

  /* ── Produce circles ─────────────────────────────────────────────────────── */
  .fb-produce {
    stroke: var(--accent);
    stroke-opacity: 0.22;
    stroke-width: 1.2;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-produce-rise 0.5s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  }
  .fp1 { animation-delay: 0.15s; }
  .fp2 { animation-delay: 0.30s; }
  .fp3 { animation-delay: 0.42s; }
  .fp4 { animation-delay: 0.55s; }

  @keyframes fb-produce-rise {
    from { opacity: 0; transform: scale(0.4) translateY(8px); }
    to   { opacity: 1; transform: scale(1)   translateY(0);   }
  }

  .fb-stem {
    stroke: var(--accent);
    stroke-opacity: 0.30;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  /* ── Sparkle diamonds ────────────────────────────────────────────────────── */
  .fb-sparkle {
    fill: var(--accent);
    opacity: 0.15;
    transform-box: fill-box;
    transform-origin: center;
    animation: fb-sparkle-pulse 2.5s ease-in-out infinite;
  }
  .fs1 { animation-delay: 0.0s;  animation-duration: 2.4s; }
  .fs2 { animation-delay: 0.8s;  animation-duration: 3.0s; }
  .fs3 { animation-delay: 1.5s;  animation-duration: 2.7s; }
  .fs4 { animation-delay: 0.4s;  animation-duration: 2.2s; }

  @keyframes fb-sparkle-pulse {
    0%, 100% { opacity: 0.10; transform: scale(0.8) rotate(0deg);   }
    50%       { opacity: 0.25; transform: scale(1.2) rotate(45deg);  }
  }

  /* ── Disable all animations ──────────────────────────────────────────────── */
  .foods-banner-svg.no-anim .fb-vine,
  .foods-banner-svg.no-anim .fb-leaf,
  .foods-banner-svg.no-anim .fb-produce,
  .foods-banner-svg.no-anim .fb-sparkle {
    animation: none;
    stroke-dashoffset: 0;
    opacity: 1;
    transform: none;
  }
  .foods-banner-svg.no-anim .fb-leaf    { opacity: 0.18; }
  .foods-banner-svg.no-anim .fb-sparkle { opacity: 0.15; }
  @media (prefers-reduced-motion: reduce) {
    .fb-vine    { animation: none !important; stroke-dashoffset: 0 !important; }
    .fb-leaf    { animation: none !important; opacity: 0.18 !important; transform: none !important; }
    .fb-produce { animation: none !important; opacity: 1    !important; transform: none !important; }
    .fb-sparkle { animation: none !important; opacity: 0.15 !important; transform: none !important; }
  }
</style>
