import { Fragment, type MouseEvent, type KeyboardEvent } from 'react';
import { knownArtists, splitArtists } from '../lib/artists';
import { openAlbum, openArtist } from '../lib/navigation';
import { useLibrary } from '../state/LibraryProvider';
import type { Album, Track } from '../types';

const knownCache = new WeakMap<readonly Track[], { albums: readonly Album[]; known: Set<string> }>();

/** The library's known artist names, worked out once per library change and shared by every row. */
export function useKnownArtists() {
  const { albums, tracks } = useLibrary();
  const cached = knownCache.get(tracks);
  if (cached && cached.albums === albums) return cached.known;
  const known = knownArtists(albums, tracks);
  knownCache.set(tracks, { albums, known });
  return known;
}

/** Pieces of the artist string, with each credited artist marked so it can be tapped. */
export function artistSegments(raw: string, names: string[]): { text: string; artist?: string }[] {
  const out: { text: string; artist?: string }[] = [];
  const lower = raw.toLowerCase();
  let cursor = 0;
  for (const name of names) {
    const at = lower.indexOf(name.toLowerCase(), cursor);
    if (at < 0) continue;
    if (at > cursor) out.push({ text: raw.slice(cursor, at) });
    out.push({ text: raw.slice(at, at + name.length), artist: name });
    cursor = at + name.length;
  }
  if (cursor < raw.length) out.push({ text: raw.slice(cursor) });
  return out.length ? out : [{ text: raw }];
}

function activate(event: MouseEvent | KeyboardEvent, run: () => void) {
  if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
  // These sit inside a row's play button: open the page without playing the song.
  event.preventDefault();
  event.stopPropagation();
  run();
}

/** Inline link for use inside another button (a song row), so it is a span acting as a button. */
function InlineLink({ label, className, onOpen }: { label: string; className?: string; onOpen: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={className ? `name-link ${className}` : 'name-link'}
      onClick={(event) => activate(event, onOpen)}
      onKeyDown={(event) => activate(event, onOpen)}
    >
      {label}
    </span>
  );
}

/** An artist string where each credited artist opens their page. */
export function ArtistLinks({ artist, className, onOpen }: { artist: string; className?: string; onOpen?: () => void }) {
  const known = useKnownArtists();
  if (!artist.trim()) return <span className={className}>Unknown artist</span>;
  const segments = artistSegments(artist, splitArtists(artist, known));
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.artist ? (
          <InlineLink
            key={index}
            label={segment.text}
            onOpen={() => {
              onOpen?.();
              openArtist(segment.artist!);
            }}
          />
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </span>
  );
}

/** An album name that opens the album's page. */
export function AlbumLink({ album, className, onOpen }: { album: Album; className?: string; onOpen?: () => void }) {
  return (
    <InlineLink
      label={album.name}
      className={className}
      onOpen={() => {
        onOpen?.();
        openAlbum(album.id);
      }}
    />
  );
}
