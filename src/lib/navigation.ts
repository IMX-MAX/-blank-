/** Fired to open the equaliser screen from outside the page stack (the player). */
export const OPEN_EQUALISER_EVENT = 'blank:open-equaliser';

export function openEqualiser(): void {
  window.dispatchEvent(new Event(OPEN_EQUALISER_EVENT));
}

/** Fired to open an artist's page from anywhere (song rows, the player). */
export const OPEN_ARTIST_EVENT = 'blank:open-artist';
/** Fired to open an album's page from anywhere. */
export const OPEN_ALBUM_EVENT = 'blank:open-album';

export function openArtist(name: string): void {
  if (name.trim()) window.dispatchEvent(new CustomEvent(OPEN_ARTIST_EVENT, { detail: name.trim() }));
}

export function openAlbum(albumId: string | null | undefined): void {
  if (albumId) window.dispatchEvent(new CustomEvent(OPEN_ALBUM_EVENT, { detail: albumId }));
}
