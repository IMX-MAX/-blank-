import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Download, Search } from 'lucide-react';
import { errorMessage, formatTrackTime } from '../lib/format';
import { ytdlp, type YtDownload, type YtEntry, type YtListing, type YtStatus } from '../lib/ytdlp';
import { Scrim } from './overlays';

type Row = { state: 'idle' | 'waiting' | 'busy' | 'done' | 'error'; progress: number; error?: string };

/**
 * Search YouTube or paste a YouTube Music link, then download songs with yt-dlp straight into the library.
 * `onImport` adds one downloaded song and says whether it was added.
 */
export function YoutubeDialog({ onClose, onImport }: { onClose: () => void; onImport: (download: YtDownload) => Promise<boolean> }) {
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [input, setInput] = useState('');
  const [listing, setListing] = useState<YtListing | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const abort = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const busy = Object.values(rows).some((row) => row.state === 'busy' || row.state === 'waiting');

  useEffect(() => {
    let cancelled = false;
    void ytdlp.status().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      stopped.current = true;
      abort.current?.abort();
    };
  }, []);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => ({ ...current, [id]: { ...(current[id] ?? { state: 'idle', progress: 0 }), ...patch } }));

  async function search(event: FormEvent) {
    event.preventDefault();
    if (searching || busy || !input.trim()) return;
    setError('');
    setSearching(true);
    setListing(null);
    setRows({});
    try {
      const found = await ytdlp.listing(input);
      setListing(found);
      if (!found.entries.length) setError('Nothing found');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  async function add(entries: YtEntry[]) {
    stopped.current = false;
    const controller = new AbortController();
    abort.current = controller;
    entries.forEach((entry) => update(entry.id, { state: 'waiting', progress: 0, error: undefined }));
    for (const entry of entries) {
      if (stopped.current) {
        update(entry.id, { state: 'idle' });
        continue;
      }
      update(entry.id, { state: 'busy', progress: 0 });
      try {
        const download = await ytdlp.download(entry, (progress) => update(entry.id, { progress }), controller.signal);
        const added = await onImport(download);
        update(entry.id, added ? { state: 'done', progress: 1 } : { state: 'error', error: 'Could not add this song' });
      } catch (err) {
        update(entry.id, stopped.current ? { state: 'idle' } : { state: 'error', error: errorMessage(err) });
      }
    }
    abort.current = null;
  }

  function stop() {
    stopped.current = true;
    abort.current?.abort();
  }

  const available = status?.available === true;
  const pending = listing?.entries.filter((entry) => rows[entry.id]?.state !== 'done') ?? [];

  return (
    <Scrim onClose={onClose} locked={busy}>
      <div className="dialog wide yt" role="dialog">
        <h2>From YouTube Music</h2>
        {status && !status.available ? <p className="yt-note">{status.reason}</p> : null}
        <form className="yt-search" onSubmit={search}>
          <input
            autoFocus
            value={input}
            disabled={!available || busy}
            placeholder="Paste a link or search for a song"
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="white-btn" type="submit" disabled={!available || busy || searching || !input.trim()} aria-label="Search">
            <Search size={18} />
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        {searching ? <p className="yt-note">Looking…</p> : null}
        {listing?.entries.length ? (
          <>
            {listing.title || listing.entries.length > 1 ? (
              <div className="yt-head">
                <span>{listing.title ?? `${listing.entries.length} results`}</span>
                {listing.entries.length > 1 && pending.length ? (
                  <button className="pill-btn" disabled={busy} onClick={() => void add(pending)}>
                    Add all ({pending.length})
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="yt-list">
              {listing.entries.map((entry) => {
                const row = rows[entry.id];
                return (
                  <div className="yt-row" key={entry.id}>
                    {entry.thumbnail ? <img className="yt-thumb" src={entry.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="yt-thumb" />}
                    <span className="yt-copy">
                      <span className="track-title">{entry.title}</span>
                      <span className="track-sub">
                        {entry.artist}
                        {entry.durationMs ? ` · ${formatTrackTime(entry.durationMs)}` : ''}
                      </span>
                      {row?.state === 'error' ? <span className="yt-error">{row.error}</span> : null}
                    </span>
                    {row?.state === 'done' ? (
                      <span className="yt-done" aria-label="Added">
                        <Check size={18} />
                      </span>
                    ) : row?.state === 'busy' || row?.state === 'waiting' ? (
                      <span className="yt-progress">{row.state === 'busy' ? `${Math.round(row.progress * 100)}%` : 'Waiting'}</span>
                    ) : (
                      <button className="pill-btn" disabled={busy} onClick={() => void add([entry])} aria-label={`Add ${entry.title}`}>
                        <Download size={16} /> {row?.state === 'error' ? 'Retry' : 'Add'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        <p className="yt-fine">Only download music you have the right to keep.</p>
        <div className="dialog-actions">
          {busy ? (
            <button className="text-btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="white-btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </Scrim>
  );
}
