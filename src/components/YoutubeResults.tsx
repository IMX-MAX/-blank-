import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { formatTrackTime } from '../lib/format';
import { searchYoutube, YoutubeError } from '../lib/youtube-client';
import { importedTrackId, trackFromYoutube, type YtAlbum, type YtSong } from '../lib/youtube';
import { openYoutubeAlbum } from '../lib/navigation';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { AnchoredMenu, atPointer, below } from './overlays';

/** YouTube Music results under the library search. Guest mode: no account. */
export function YoutubeResults({ query }: { query: string }) {
  const library = useLibrary();
  const player = usePlayer();
  const [songs, setSongs] = useState<YtSong[]>([]);
  const [albums, setAlbums] = useState<YtAlbum[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; song: YtSong } | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setSongs([]);
      setAlbums([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus('loading');
      void searchYoutube(text, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSongs(result.songs);
          setAlbums(result.albums);
          setStatus('done');
        })
        .catch((error) => {
          if (controller.signal.aborted || error?.name === 'AbortError') return;
          setStatus('error');
          setMessage(error instanceof YoutubeError ? error.message : "Couldn't reach YouTube Music");
        });
    }, 320);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const saved = (song: YtSong) => {
    void savedTick;
    const id = importedTrackId(song.videoId);
    return id ? library.tracks.some((track) => track.id === id) : false;
  };

  const playable = (song: YtSong) => {
    const id = importedTrackId(song.videoId);
    return library.tracks.find((track) => track.id === id) ?? trackFromYoutube(song);
  };

  const download = async (song: YtSong) => {
    if (saved(song) || busy[song.videoId]) return;
    setBusy((current) => ({ ...current, [song.videoId]: true }));
    setMessage('');
    try {
      await library.saveYoutubeSong(song);
      setSavedTick((tick) => tick + 1);
      setMessage(`Saved “${song.title}” on this device`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not download that song');
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[song.videoId];
        return next;
      });
    }
  };

  if (query.trim().length < 2) return null;

  return (
    <section className="yt-block" aria-label="YouTube Music">
      <h2 className="yt-label">YouTube Music</h2>
      {status === 'loading' ? <p className="yt-status">Searching YouTube Music…</p> : null}
      {status === 'error' ? <p className="yt-status">{message}</p> : null}
      {status === 'done' && !songs.length && !albums.length ? <p className="yt-status">Nothing on YouTube Music for that</p> : null}
      {albums.length ? (
        <div className="yt-albums">
          {albums.slice(0, 8).map((album) => (
            <button key={album.browseId} className="yt-album" onClick={() => openYoutubeAlbum(album)}>
              <Cover fileId={null} src={album.thumbnail} hue={null} radius={12} className="yt-album-art" />
              <span className="track-title">{album.title}</span>
              <span className="track-sub">{album.artist || 'Album'}</span>
            </button>
          ))}
        </div>
      ) : null}
      {songs.length ? (
        <div className="search-tracks yt-songs">
          {songs.slice(0, 20).map((song) => {
            const onDevice = saved(song);
            return (
              <div key={song.videoId} className="yt-row">
                <button
                  className="search-track"
                  onClick={() => player.playTracks([playable(song)], 0)}
                  onContextMenu={(event) => setMenu({ ...atPointer(event), song })}
                >
                  <Cover fileId={song.thumbnail ? `yt:${song.videoId}` : null} src={song.thumbnail || null} hue={null} radius={8} className="search-art" />
                  <span>
                    <span className="track-title">{song.title}</span>
                    <span className="track-sub">
                      {song.artist || 'Unknown artist'}
                      {song.album ? ` · ${song.album}` : ''}
                      {onDevice ? ' · On this device' : ''}
                    </span>
                  </span>
                  <span className="track-dur">{formatTrackTime(song.durationMs)}</span>
                </button>
                <button
                  className="icon-btn yt-save"
                  aria-label={onDevice ? `${song.title} is on this device` : `Download ${song.title}`}
                  disabled={onDevice || busy[song.videoId]}
                  onClick={() => void download(song)}
                  onContextMenu={(event) => setMenu({ ...below(event.currentTarget, 'right'), song })}
                >
                  <Download size={16} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {message && status !== 'error' ? <p className="yt-status">{message}</p> : null}
      {menu ? (
        <AnchoredMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { id: 'play', label: 'Play', onClick: () => player.playTracks([playable(menu.song)], 0) },
            {
              id: 'next',
              label: 'Play next',
              onClick: () => player.playNext(playable(menu.song)),
            },
            {
              id: 'download',
              label: saved(menu.song) ? 'On this device' : busy[menu.song.videoId] ? 'Downloading…' : 'Download',
              onClick: () => void download(menu.song),
            },
          ]}
        />
      ) : null}
    </section>
  );
}
