import type { KeyboardEvent, MouseEvent } from 'react';
import { openAlbum } from '../lib/navigation';
import type { Album } from '../types';

function activate(event: MouseEvent | KeyboardEvent, run: () => void) {
  if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
  // This sits inside a row's play button: open the album without playing the song.
  event.preventDefault();
  event.stopPropagation();
  run();
}

/** An album name that opens the album's page. A span acting as a button, as it sits inside a song row's button. */
export function AlbumLink({ album, className, onOpen }: { album: Album; className?: string; onOpen?: () => void }) {
  const open = () => {
    onOpen?.();
    openAlbum(album.id);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={className ? `name-link ${className}` : 'name-link'}
      onClick={(event) => activate(event, open)}
      onKeyDown={(event) => activate(event, open)}
    >
      {album.name}
    </span>
  );
}
