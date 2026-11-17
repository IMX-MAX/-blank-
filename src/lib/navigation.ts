/** Fired to open the equaliser screen from outside the page stack (the player). */
export const OPEN_EQUALISER_EVENT = 'blank:open-equaliser';

export function openEqualiser(): void {
  window.dispatchEvent(new Event(OPEN_EQUALISER_EVENT));
}

/** Fired to open a YouTube Music album that is not in the library yet. */
export const OPEN_YOUTUBE_ALBUM_EVENT = 'blank:open-youtube-album';

export function openYoutubeAlbum(album: { browseId: string; title: string; artist: string; thumbnail: string; year: number | null }): void {
  window.dispatchEvent(new CustomEvent(OPEN_YOUTUBE_ALBUM_EVENT, { detail: album }));
}

/** Fired to open an album's page from anywhere. */
export const OPEN_ALBUM_EVENT = 'blank:open-album';

export function openAlbum(albumId: string | null | undefined): void {
  if (albumId) window.dispatchEvent(new CustomEvent(OPEN_ALBUM_EVENT, { detail: albumId }));
}

/**
 * Screens inside an overlay (choosing lyrics to share) can take the back button first: the newest handler that
 * returns true has dealt with it.
 */
const backHandlers: Array<() => boolean> = [];

export function interceptBack(handler: () => boolean): () => void {
  backHandlers.push(handler);
  return () => {
    const at = backHandlers.lastIndexOf(handler);
    if (at >= 0) backHandlers.splice(at, 1);
  };
}

export function handleInterceptedBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i -= 1) if (backHandlers[i]!()) return true;
  return false;
}
