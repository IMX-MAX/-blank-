import { flushSync } from 'react-dom';

type Direction = 'forward' | 'back';

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export const supportsViewTransitions =
  typeof document !== 'undefined' && typeof (document as TransitionDocument).startViewTransition === 'function';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (supportsViewTransitions) document.documentElement.classList.add('vt');

function heroOf(albumId: string | null | undefined): HTMLElement | null {
  if (!albumId) return null;
  return document.querySelector<HTMLElement>(`[data-album-id="${CSS.escape(albumId)}"] .card-cover`);
}

/**
 * Runs a navigation state change inside a View Transition. When `heroAlbumId` is given, the album's
 * cover on the library grid and on the album page share a transition name so the cover morphs.
 */
export function navigateWithTransition(update: () => void, direction: Direction, heroAlbumId?: string | null) {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  let card = direction === 'forward' ? heroOf(heroAlbumId) : null;
  if (card) card.style.viewTransitionName = 'album-hero';

  const transition = doc.startViewTransition(() => {
    flushSync(update);
    if (direction === 'back') {
      card = heroOf(heroAlbumId);
      if (card) card.style.viewTransitionName = 'album-hero';
    }
  });
  void transition.finished.finally(() => {
    if (card) card.style.viewTransitionName = '';
    delete root.dataset.nav;
  });
}
