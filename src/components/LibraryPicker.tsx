import { useMemo, useState } from 'react';
import { Check, Search, Upload, X } from 'lucide-react';
import { pickerRows } from '../lib/artists';
import { coverFor } from '../lib/covers';
import { formatTrackTime, plural } from '../lib/format';
import { tickHaptic } from '../lib/haptics';
import { useLibrary } from '../state/LibraryProvider';
import { useSettings } from '../state/SettingsProvider';
import type { Album } from '../types';
import { Cover } from './Cover';
import { Scrim } from './overlays';

const PAGE = 60;

/**
 * Add songs already in the library to a playlist: search everything by title, artist or album, tick as many as
 * you like, and they are linked into the playlist (the same song, not another copy). Uploading new files is
 * still there for songs you do not have yet.
 */
export function LibraryPicker({
  playlist,
  onClose,
  onConfirm,
  onUpload,
}: {
  playlist: Album;
  onClose: () => void;
  onConfirm: (trackIds: string[]) => void;
  onUpload: () => void;
}) {
  const { tracks, albums, tracksFor } = useLibrary();
  const { songCovers } = useSettings();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const already = useMemo(() => new Set(tracksFor(playlist).map((track) => track.id)), [playlist, tracksFor]);
  const rows = useMemo(() => pickerRows(query, tracks, albums, already), [query, tracks, albums, already]);
  const shown = rows.slice(0, limit);
  const free = rows.filter((row) => !row.added);
  const allShownPicked = free.length > 0 && free.every((row) => picked.includes(row.track.id));

  const toggle = (id: string) => {
    tickHaptic();
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <Scrim onClose={onClose}>
      <div className="dialog picker-sheet" role="dialog" aria-label={`Add songs to ${playlist.name}`}>
        <header className="picker-head">
          <div>
            <h2>Add songs</h2>
            <p className="picker-to">to {playlist.name}</p>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="picker-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search songs, artists or albums"
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
          />
          {query ? (
            <button className="picker-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="picker-bar">
          <span>{query ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}` : `${plural(tracks.length, 'song')} in your library`}</span>
          {free.length ? (
            <button
              className="picker-all"
              onClick={() =>
                setPicked((current) =>
                  allShownPicked
                    ? current.filter((id) => !free.some((row) => row.track.id === id))
                    : [...current, ...free.map((row) => row.track.id).filter((id) => !current.includes(id))],
                )
              }
            >
              {allShownPicked ? 'Clear' : query ? 'Select matches' : 'Select all'}
            </button>
          ) : null}
        </div>
        <div
          className="picker-list"
          data-haptic="off"
          onScroll={(event) => {
            const el = event.currentTarget;
            if (limit < rows.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) setLimit((value) => value + PAGE);
          }}
        >
          {!tracks.length ? <p className="empty-note">Add songs to your library first</p> : null}
          {tracks.length && !rows.length ? <p className="empty-note">No songs match “{query.trim()}”</p> : null}
          {shown.map(({ track, album, added }) => {
            const on = added || picked.includes(track.id);
            return (
              <button
                key={track.id}
                className={`picker-row${on ? ' on' : ''}${added ? ' added' : ''}`}
                disabled={added}
                aria-pressed={on}
                onClick={() => toggle(track.id)}
              >
                <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} radius={10} className="picker-art" />
                <span className="picker-copy">
                  <span className="track-title">{track.title}</span>
                  <span className="track-sub">
                    {track.artist || 'Unknown artist'}
                    {album?.kind === 'album' ? ` · ${album.name}` : ''}
                  </span>
                </span>
                {added ? (
                  <span className="picker-added">Added</span>
                ) : (
                  <span className="picker-dur">{formatTrackTime(track.durationMs)}</span>
                )}
                <span className={on ? 'picker-check on' : 'picker-check'} aria-hidden>
                  {on ? <Check size={14} strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <footer className="picker-foot">
          <button className="text-btn picker-upload" onClick={onUpload}>
            <Upload size={16} /> Upload files
          </button>
          <button className="white-btn" disabled={!picked.length} onClick={() => onConfirm(picked)}>
            {picked.length ? `Add ${plural(picked.length, 'song')}` : 'Add'}
          </button>
        </footer>
      </div>
    </Scrim>
  );
}
