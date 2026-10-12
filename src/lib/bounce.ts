const TARGET = 'button, [role="button"], a[href], summary';
const SKIP = '[data-no-bounce], .slider, .eq-handle, .ly, .scrub';

const DOWN_MS = 110;
const RELEASE_MS = 520;
const TOUCH_HOLD_MS = 70;
const MOVE_LIMIT = 8;
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
  let timer = 0;
  let origin = { x: 0, y: 0 };

  const squish = (el: HTMLElement) => {
    hold = el.animate([{ scale: '1' }, { scale: String(depth) }], {
      duration: DOWN_MS,
      easing: 'cubic-bezier(.2,.8,.3,1)',
      fill: 'forwards',
    });
  };

  const spring = (el: HTMLElement) => {
    const frames = RELEASE_FRAMES.map((f) => ({ ...f, scale: f.scale.replace('var(--from)', String(depth)) }));
    el.animate(frames, { duration: RELEASE_MS, easing: 'cubic-bezier(.3,.7,.4,1)' });
  };

  /** The finger turned into a scroll or a drag: ease back without the bounce. */
  const abandon = () => {
    const el = pressed;
    window.clearTimeout(timer);
    timer = 0;
    pressed = null;
    if (!el || !hold) {
      hold = null;
      return;
    }
    const current = getComputedStyle(el).scale;
    hold.cancel();
    hold = null;
    el.animate([{ scale: current === 'none' ? '1' : current }, { scale: '1' }], { duration: 140, easing: 'ease-out' });
  };

  const release = () => {
    const el = pressed;
    if (!el) return;
    const waiting = timer !== 0;
    window.clearTimeout(timer);
    timer = 0;
    pressed = null;
    hold?.cancel();
    hold = null;
    if (waiting) {
      el.animate(
        [
          { scale: '1', offset: 0 },
          { scale: String(depth), offset: 0.12 },
          { scale: '1.09', offset: 0.4 },
          { scale: '0.975', offset: 0.65 },
          { scale: '1.012', offset: 0.85 },
          { scale: '1', offset: 1 },
        ],
        { duration: RELEASE_MS, easing: 'cubic-bezier(.3,.7,.4,1)' },
      );
      return;
    }
    spring(el);
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGET);
      if (!el || el.matches(SKIP) || (el as HTMLButtonElement).disabled) return;
      abandon();
      pressed = el;
      depth = pressDepth(el);
      origin = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse') {
        squish(el);
      } else {
        // A touch that starts a scroll should not look like a press, so wait a moment before squishing.
        timer = window.setTimeout(() => {
          timer = 0;
          if (pressed === el) squish(el);
        }, TOUCH_HOLD_MS);
      }
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (pressed && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_LIMIT) abandon();
    },
    { passive: true },
  );
  document.addEventListener('scroll', abandon, { passive: true, capture: true });
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', abandon, { passive: true });
  window.addEventListener('blur', abandon);
}
