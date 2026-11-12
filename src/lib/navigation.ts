/** Fired to open the equaliser screen from outside the page stack (the player). */
export const OPEN_EQUALISER_EVENT = 'blank:open-equaliser';

export function openEqualiser(): void {
  window.dispatchEvent(new Event(OPEN_EQUALISER_EVENT));
}
