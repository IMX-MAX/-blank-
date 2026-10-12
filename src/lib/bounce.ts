const TARGET = 'button, [role="button"], a[href], summary';
const SKIP = '[data-no-bounce], .slider, .eq-handle, .ly, .scrub';

const DOWN_MS = 110;
const RELEASE_MS = 520;
const RELEASE_FRAMES = [
  { scale: 'var(--from)' },
  { scale: '1.09', offset: 0.35 },
  { scale: '0.975', offset: 0.62 },
  { scale: '1.012', offset: 0.82 },
  { scale: '1' },
];

function pressDepth(el: HTMLElement): number {
  const { width, height } = el.getBoundingClientRect();
  const size = Math.max(width, height);
  if (size > 240) return 0.985;
  if (size > 120) return 0.95;
  return 0.86;
}

export function installBounce() {
  if (typeof window === 'undefined' || !('animate' in HTMLElement.prototype)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let pressed: HTMLElement | null = null;
  let depth = 1;
  let hold: Animation | null = null;

  const release = () => {
    const el = pressed;
    if (!el) return;
    pressed = null;
    hold?.cancel();
    hold = null;
    const frames = RELEASE_FRAMES.map((f) => ({ ...f, scale: f.scale.replace('var(--from)', String(depth)) }));
    el.animate(frames, { duration: RELEASE_MS, easing: 'cubic-bezier(.3,.7,.4,1)' });
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGET);
      if (!el || el.matches(SKIP) || (el as HTMLButtonElement).disabled) return;
      release();
      pressed = el;
      depth = pressDepth(el);
      hold = el.animate([{ scale: '1' }, { scale: String(depth) }], {
        duration: DOWN_MS,
        easing: 'cubic-bezier(.2,.8,.3,1)',
        fill: 'forwards',
      });
    },
    { passive: true },
  );
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
}
