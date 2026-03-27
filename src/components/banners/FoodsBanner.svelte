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
        if (noLoop) return; // stop after first word when no-loop
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
  <div class="tw-decoration">
    <span class="tw-rule"></span>
    <span class="tw-diamond">✦</span>
    <span class="tw-rule"></span>
  </div>
  <div class="tw-label">Today's Menu</div>
  <div class="tw-text">
    {displayText}<span class="tw-cursor" class:no-anim={noAnim}>|</span>
  </div>
</div>

<style>
  .tw-banner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    pointer-events: none;
    overflow: hidden;
  }

  .tw-decoration {
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0.35;
  }
  .tw-rule {
    display: block;
    width: 40px;
    height: 1px;
    background: var(--accent);
  }
  .tw-diamond {
    font-size: 8px;
    color: var(--accent);
    line-height: 1;
  }

  .tw-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0.55;
  }

  .tw-text {
    font-size: 18px;
    font-weight: 600;
    color: var(--accent);
    opacity: 0.75;
    letter-spacing: 0.01em;
    min-height: 1.4em;
    display: flex;
    align-items: center;
  }

  .tw-cursor {
    display: inline-block;
    margin-left: 1px;
    color: var(--accent);
    font-weight: 300;
    animation: tw-blink 0.9s step-end infinite;
  }
  .tw-cursor.no-anim {
    animation: none;
    opacity: 0;
  }

  @keyframes tw-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .tw-cursor { animation: none; opacity: 0; }
  }
</style>
