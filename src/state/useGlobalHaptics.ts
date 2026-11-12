import { useEffect } from 'react';
import { detents } from '../lib/haptics-core';
import { pressHaptic, tapHaptic, tickHaptic, warningHaptic } from '../lib/haptics';

const TAPPABLE = 'button, [role="button"], [role="switch"], [role="radio"], [role="menuitem"], a[href]';
/** At most this many ticks across a slider's whole range, however fine its steps. */
const MAX_DETENTS = 24;

/**
 * Haptics for the whole app from one place: a light tap on buttons, ticks as sliders pass steps, a firmer tap on
 * a long press, and a warning on confirming something destructive. Scrolling, lyric lines and text fields give
 * nothing; anything inside [data-haptic="off"] opts out (such as rows with their own haptics).
 */
export function useGlobalHaptics() {
  useEffect(() => {
    const sliders = new WeakMap<HTMLInputElement, ReturnType<typeof detents>>();

    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest?.(TAPPABLE) as HTMLElement | null;
      if (!target || target.closest('[data-haptic="off"]')) return;
      if ((target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true') return;
      if (target.classList.contains('danger-btn')) warningHaptic();
      else tapHaptic();
    };

    const onInput = (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input || input.type !== 'range' || input.closest('[data-haptic="off"]')) return;
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const step = Number(input.step) || 1;
      const steps = Math.max(1, Math.min(MAX_DETENTS, Math.round((max - min) / step)));
      let crossed = sliders.get(input);
      if (!crossed) {
        crossed = detents(steps);
        sliders.set(input, crossed);
        crossed((Number(input.defaultValue) - min) / (max - min || 1));
      }
      if (crossed((Number(input.value) - min) / (max - min || 1))) tickHaptic();
    };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || target.closest('[data-haptic="off"], input, textarea')) return;
      pressHaptic();
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, []);
}
