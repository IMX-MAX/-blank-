import { useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { Bell, ChevronLeft, Link, MoreHorizontal, Plus, Search, Settings, WifiOff } from 'lucide-react';
import { videoToAudio } from '../lib/convert';
import { errorMessage, formatBytes, plural, relativeTime } from '../lib/format';
import { isNativeApp } from '../lib/shell-cache';
import { startRecorder, type RecorderHandle } from '../lib/record';
import { useAuth } from '../state/AuthProvider';
import { useLibrary } from '../state/LibraryProvider';
import { LOCAL_ONLY } from '../config';
import { useOffline, useOnline } from '../state/OfflineProvider';
import { usePlayer } from '../state/PlayerProvider';
import type { Album, Folder, Track } from '../types';
import { AlbumView } from './AlbumView';
import { LibraryView } from './LibraryView';
import { navigateWithTransition } from '../lib/transition';
import { PlayerBar } from './PlayerBar';
import { Presence } from './Presence';
import {
  AddMenu,
  AnchoredMenu,
  ConfirmDialog,
  NameDialog,
  PickerDialog,
  RecordCard,
  below,
  type MenuItem,
  type Point,
} from './overlays';

type Route = { name: 'library' } | { name: 'folder'; folderId: string } | { name: 'album'; albumId: string };

type Dialog =
  | { kind: 'folder' }
  | { kind: 'project' }
  | { kind: 'playlist' }
  | { kind: 'playlist-for-track'; track: Track }
  | { kind: 'rename-album'; album: Album }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'delete-album'; album: Album }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'delete-track'; track: Track }
  | { kind: 'move'; album: Album }
  | { kind: 'add-playlist'; track: Track }
  | { kind: 'pick-tracks'; playlist: Album };

export function Shell() {
  const { user, signOut, signUp, leaveOffline } = useAuth();
  const library = useLibrary();
  const player = usePlayer();
  const offline = useOffline();
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'library' }]);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'bell' | 'settings' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [converting, setConverting] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const recordStarted = useRef(0);
  const toastId = useRef(0);
  const route = stack[stack.length - 1] ?? { name: 'library' as const };

  const album = route.name === 'album' ? library.albums.find((item) => item.id === route.albumId) : undefined;
  const folder = route.name === 'folder' ? library.folders.find((item) => item.id === route.folderId) : undefined;

  function notify(message: string) {
    const id = toastId.current + 1;
    toastId.current = id;
    setToast(message);
    window.setTimeout(() => {
      if (toastId.current === id) setToast(null);
    }, 2800);
  }

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) notify(success);
    } catch (err) {
      notify(errorMessage(err));
    }
  }

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((Date.now() - recordStarted.current) / 1000), 200);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (!library.ready) return;
    if (route.name === 'album' && !library.albums.some((item) => item.id === route.albumId)) {
      setStack((current) => current.slice(0, -1));
    }
    if (route.name === 'folder' && !library.folders.some((item) => item.id === route.folderId)) {
      setStack((current) => current.slice(0, -1));
    }
  }, [library.albums, library.folders, library.ready, route]);

  function closeTopmost(): boolean {
    if (recording) cancelRecording();
    else if (dialog) setDialog(null);
    else if (addOpen) setAddOpen(false);
    else if (menu) setMenu(null);
    else if (searchOpen) {
      setSearchOpen(false);
      setQuery('');
    } else if (panel) setPanel(null);
    else if (player.lyricsOpen) player.setLyricsOpen(false);
    else if (player.queueOpen) player.setQueueOpen(false);
    else return false;
    return true;
  }

  const backButton = useRef<() => void>(() => undefined);
  backButton.current = () => {
    if (closeTopmost()) return;
    if (stack.length > 1) back();
    else void App.minimizeApp();
  };

  useEffect(() => {
    if (!isNativeApp()) return;
    const handle = App.addListener('backButton', () => backButton.current());
    return () => {
      void handle.then((listener) => listener.remove());
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest('input, textarea'));
      if (event.key === 'Escape') {
        closeTopmost();
        return;
      }
      if (typing || document.querySelector('[data-overlay]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        player.toggle();
      } else if (event.key === 'ArrowRight') {
        player.seek(player.currentTime + 5);
      } else if (event.key === 'ArrowLeft') {
        player.seek(Math.max(0, player.currentTime - 5));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addOpen, dialog, menu, panel, player, recording, searchOpen]);

  function push(next: Route) {
    setSearchOpen(false);
    setQuery('');
    navigateWithTransition(
      () => setStack((current) => [...current, next]),
      'forward',
      next.name === 'album' ? next.albumId : null,
    );
  }

  function back() {
    setSearchOpen(false);
    setQuery('');
    if (stack.length < 2) return;
    navigateWithTransition(
      () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      'back',
      route.name === 'album' ? route.albumId : null,
    );
  }

  async function importFiles(files: File[]) {
    const target =
      route.name === 'folder'
        ? { folderId: route.folderId }
        : route.name === 'album' && album?.kind === 'album'
          ? { albumId: album.id }
          : undefined;
    const created = await library.importFiles(files, target);
    if (route.name === 'album' && album?.kind === 'playlist' && created.length) {
      await library.addTracksToPlaylist(album.id, created.map((track) => track.id));
    }
    if (!created.length) notify('Choose audio files — mp3, flac, wav, m4a, and similar');
    else notify(`Added ${plural(created.length, 'track')}`);
  }

  function openFiles() {
    setAddOpen(false);
    fileRef.current?.click();
  }

  function openVideo() {
    setAddOpen(false);
    videoRef.current?.click();
  }

  async function convertFiles(files: File[]) {
    for (const file of files) {
      setConverting(file.name);
      try {
        const audio = await videoToAudio(file);
        await importFiles([audio]);
      } catch (err) {
        notify(errorMessage(err));
      } finally {
        setConverting(null);
      }
    }
  }

  async function beginRecording() {
    setAddOpen(false);
    try {
      recorderRef.current = await startRecorder();
      recordStarted.current = Date.now();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      notify(errorMessage(err));
    }
  }

  function cancelRecording() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    const file = recorder.stop();
    if (file.size < 1000) {
      notify('That recording was empty');
      return;
    }
    await importFiles([file]);
  }

  function playCollection(item: Album) {
    const list = library.tracksFor(item);
    if (!list.length) {
      notify(item.kind === 'playlist' ? 'This playlist is empty' : 'This album is empty');
      return;
    }
    if (list.some((track) => track.id === player.track?.id)) player.toggle();
    else player.playTracks(list, 0);
  }

  function offlineItem(tracks: Track[], noun: string): MenuItem[] {
    if (!tracks.length || LOCAL_ONLY) return [];
    const pending = tracks.filter((track) => !offline.isSaved(track.id));
    if (!pending.length) {
      return [
        {
          id: 'offline-remove',
          label: 'Remove download',
          onClick: () => void run(() => offline.remove(tracks), `Removed from this device`),
        },
      ];
    }
    if (tracks.every((track) => offline.progress[track.id] !== undefined)) {
      return [{ id: 'offline-busy', label: 'Downloading…', onClick: () => undefined }];
    }
    return [
      {
        id: 'offline',
        label: 'Make available offline',
        onClick: () => {
          if (!online) {
            notify('Connect to the internet to download songs');
            return;
          }
          notify(pending.length > 1 ? `Downloading ${plural(pending.length, 'song')}` : `Downloading ${noun}`);
          void run(() => offline.makeAvailable(pending), pending.length > 1 ? 'Songs are available offline' : 'Available offline');
        },
      },
    ];
  }

  function albumMenu(item: Album, at: Point) {
    const items: MenuItem[] = [
      { id: 'play', label: 'Play', onClick: () => playCollection(item) },
      ...offlineItem(library.tracksFor(item), item.name),
      { id: 'rename', label: 'Rename', onClick: () => setDialog({ kind: 'rename-album', album: item }) },
      { id: 'move', label: 'Move to folder', onClick: () => setDialog({ kind: 'move', album: item }) },
      {
        id: 'delete',
        label: item.kind === 'playlist' ? 'Delete playlist' : 'Delete album',
        danger: true,
        onClick: () => setDialog({ kind: 'delete-album', album: item }),
      },
    ];
    setMenu({ ...at, items });
  }

  function trackMenu(track: Track, at: Point, from?: Album) {
    const items: MenuItem[] = [
      { id: 'play', label: 'Play', onClick: () => player.playTracks(from ? library.tracksFor(from) : [track], from ? Math.max(0, library.tracksFor(from).findIndex((item) => item.id === track.id)) : 0) },
      { id: 'next', label: 'Play next', onClick: () => player.playNext(track) },
      ...offlineItem([track], track.title),
      { id: 'add', label: 'Add to playlist', onClick: () => setDialog({ kind: 'add-playlist', track }) },
    ];
    if (from?.kind === 'playlist') {
      items.push({
        id: 'remove',
        label: 'Remove from playlist',
        onClick: () => void run(() => library.removeFromPlaylist(from.id, track.id)),
      });
    }
    items.push({
      id: 'delete',
      label: 'Delete from library',
      danger: true,
      onClick: () => setDialog({ kind: 'delete-track', track }),
    });
    setMenu({ ...at, items });
  }

  const recent = [...library.tracks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
  const fresh = library.tracks.some((track) => Date.now() - new Date(track.createdAt).getTime() < 6 * 60 * 60 * 1000);
  const activeQuery = searchOpen ? query : '';
  const libraryAlbums =
    activeQuery && route.name === 'library'
      ? library.albums
      : route.name === 'folder'
        ? library.albums.filter((item) => item.folderId === route.folderId)
        : library.albums.filter((item) => !item.folderId);
  const libraryFolders = route.name === 'library' && !activeQuery ? library.folders : [];

  const headerTitle =
    route.name === 'folder' ? (folder?.name ?? 'Folder') : route.name === 'library' ? '[blank]' : '';

  return (
    <div
      className={player.track ? 'app has-player' : 'app'}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length) void run(() => importFiles(files));
      }}
    >
      <header className="topbar">
        <div className="topbar-left">
          {route.name === 'library' ? (
            <h1 className="wordmark">[blank]</h1>
          ) : (
            <button className="icon-btn" aria-label="Back" onClick={back}>
              <ChevronLeft size={20} />
            </button>
          )}
          {route.name === 'folder' ? <h1 className="wordmark folder-title">{headerTitle}</h1> : null}
          {library.syncing && library.ready && route.name === 'library' && online ? <span className="sync-dot" title="Syncing" /> : null}
          {user?.stale ? (
            <button className="offline-note" title="Sign in to sync your library" onClick={leaveOffline}>
              <WifiOff size={14} /> Sign in to sync
            </button>
          ) : !online || !library.live ? (
            <span className="offline-note" title="Songs saved on this device still play">
              <WifiOff size={14} /> Offline
            </span>
          ) : null}
        </div>
        <div className="topbar-right">
          {route.name === 'album' && album ? (
            <button
              className="icon-btn"
              aria-label="Copy track list"
              onClick={() => {
                const lines = [
                  album.name,
                  album.artist,
                  ...library.tracksFor(album).map((track, index) => `${index + 1}. ${track.title} — ${track.artist}`),
                ];
                void navigator.clipboard.writeText(lines.join('\n')).then(
                  () => notify('Copied track list'),
                  () => notify('Could not copy'),
                );
              }}
            >
              <Link size={18} />
            </button>
          ) : (
            <button
              className="icon-btn bell-btn"
              aria-label="Notifications"
              onClick={() => setPanel(panel === 'bell' ? null : 'bell')}
            >
              <Bell size={18} />
              {fresh ? <span className="badge" /> : null}
            </button>
          )}
          <button
            className={searchOpen ? 'icon-btn on' : 'icon-btn'}
            aria-label="Search"
            onClick={() => {
              setSearchOpen((open) => !open);
              setPanel(null);
            }}
          >
            <Search size={18} />
          </button>
          {route.name === 'album' && album ? (
            <button
              className="icon-btn"
              aria-label="Album options"
              onClick={(event) => albumMenu(album, below(event.currentTarget))}
            >
              <MoreHorizontal size={18} />
            </button>
          ) : null}
          {route.name === 'folder' && folder ? (
            <button
              className="icon-btn"
              aria-label="Folder options"
              onClick={(event) => {
                const at = below(event.currentTarget, 'right');
                setMenu({
                  ...at,
                  items: [
                    { id: 'rename', label: 'Rename folder', onClick: () => setDialog({ kind: 'rename-folder', folder }) },
                    {
                      id: 'delete',
                      label: 'Delete folder',
                      danger: true,
                      onClick: () => setDialog({ kind: 'delete-folder', folder }),
                    },
                  ],
                });
              }}
            >
              <MoreHorizontal size={18} />
            </button>
          ) : null}
          {route.name !== 'album' ? (
            <button
              className="icon-btn"
              aria-label="Settings"
              onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            >
              <Settings size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <Presence show={searchOpen}>
        <div className="search-bar">
          <input
            autoFocus
            value={query}
            placeholder="Search your library"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Presence>

      {!library.ready ? (
        <main className="stage">
          <p className="empty-note">Opening your library</p>
        </main>
      ) : route.name === 'album' && album ? (
        <AlbumView
          album={album}
          tracks={library.tracksFor(album)}
          query={activeQuery}
          onPlay={() => playCollection(album)}
          onTrack={(track) => player.toggleTrack(track, library.tracksFor(album))}
          onTrackMenu={(track, at) => trackMenu(track, at, album)}
          onAdd={() => {
            if (album.kind === 'playlist') setDialog({ kind: 'pick-tracks', playlist: album });
            else openFiles();
          }}
          onCover={(file) => void run(() => library.setAlbumCover(album.id, file), 'Cover updated')}
        />
      ) : (
        <LibraryView
          folders={libraryFolders}
          albums={libraryAlbums}
          tracks={library.tracks}
          query={activeQuery}
          onOpenFolder={(folderId) => push({ name: 'folder', folderId })}
          onOpenAlbum={(albumId) => push({ name: 'album', albumId })}
          onPlayAlbum={playCollection}
          onAlbumMenu={albumMenu}
          onFolderMenu={(item, at) =>
            setMenu({
              ...at,
              items: [
                { id: 'open', label: 'Open', onClick: () => push({ name: 'folder', folderId: item.id }) },
                { id: 'rename', label: 'Rename', onClick: () => setDialog({ kind: 'rename-folder', folder: item }) },
                {
                  id: 'delete',
                  label: 'Delete folder',
                  danger: true,
                  onClick: () => setDialog({ kind: 'delete-folder', folder: item }),
                },
              ],
            })
          }
          onTrackMenu={(track, at) => trackMenu(track, at)}
          onPlayTrack={(track) => player.playTracks([track], 0)}
        />
      )}

      {route.name !== 'album' ? (
        <button className="add-btn" onClick={() => setAddOpen(true)}>
          <Plus size={18} /> Add
        </button>
      ) : null}

      {converting ? (
        <div className="upload-pill">
          Converting
          <span>{converting}</span>
        </div>
      ) : null}
      {library.upload ? (
        <div className="upload-pill">
          Adding {library.upload.current} of {library.upload.total}
          <span>{library.upload.name}</span>
        </div>
      ) : null}

      <PlayerBar />

      <input
        ref={fileRef}
        className="hidden-input"
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,.alac"
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void run(() => importFiles(files));
        }}
      />
      <input
        ref={videoRef}
        className="hidden-input"
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm,.m4v"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void convertFiles(files);
        }}
      />

      <Presence show={addOpen}>
        <AddMenu
          onClose={() => setAddOpen(false)}
          onAudio={openFiles}
          onConvert={openVideo}
          onRecord={() => void beginRecording()}
          onFolder={() => {
            setAddOpen(false);
            setDialog({ kind: 'folder' });
          }}
          onProject={() => {
            setAddOpen(false);
            setDialog({ kind: 'project' });
          }}
        />
      </Presence>
      <Presence show={recording}>
        <RecordCard
          elapsed={elapsed}
          onStop={() => void run(() => finishRecording())}
          onCancel={cancelRecording}
        />
      </Presence>

      <Presence show={menu !== null}>
        {menu ? <AnchoredMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      </Presence>

      <Presence show={panel !== null}>
      {panel ? (
        <button className="panel-scrim" data-overlay aria-label="Close" onClick={() => setPanel(null)} />
      ) : null}
      {panel === 'bell' ? (
        <aside className="popover bell" data-overlay>
          <h2>Activity</h2>
          {recent.length === 0 ? <p className="empty-note">Nothing new yet</p> : null}
          {recent.map((track) => (
            <button key={track.id} className="activity" onClick={() => player.playTracks([track], 0)}>
              <span>Added {track.title}</span>
              <small>{relativeTime(track.createdAt)}</small>
            </button>
          ))}
        </aside>
      ) : null}
      {panel === 'settings' ? (
        <aside className="popover settings" data-overlay>
          <h2>{LOCAL_ONLY ? 'Profile' : 'Account'}</h2>
          <p className="account-name">{user?.name || 'Listener'}</p>
          {LOCAL_ONLY ? (
            <p className="account-note">
              {plural(library.tracks.length, 'song')} stored on this phone
            </p>
          ) : (
            <>
              <p className="account-email">{user?.email}</p>
              <p className="account-note">Library synced to the cloud</p>
              <p className="account-note">
                {offline.count
                  ? `${plural(offline.count, 'song')} saved on this device · ${formatBytes(offline.bytes)}`
                  : 'Right-click a song or album to make it available offline'}
              </p>
              {offline.count ? (
                <button
                  className="text-btn create-inline"
                  onClick={() => void run(() => offline.removeAll(), 'Removed all downloads')}
                >
                  Remove all downloads
                </button>
              ) : null}
            </>
          )}
          <button
            className="text-btn create-inline"
            onClick={() => {
              setPanel(null);
              setDialog({ kind: 'playlist' });
            }}
          >
            New playlist
          </button>
          {LOCAL_ONLY ? (
            <button
              className="white-btn"
              onClick={() => {
                const next = window.prompt('Your name', user?.name ?? '')?.trim();
                if (next) void run(() => signUp(next, '', ''), 'Name updated');
              }}
            >
              Change name
            </button>
          ) : (
            <button className="white-btn" onClick={() => void run(() => signOut())}>
              Sign out
            </button>
          )}
        </aside>
      ) : null}
      </Presence>

      <Presence show={dialog !== null}>
      {dialog?.kind === 'folder' ? (
        <NameDialog
          title="New folder"
          placeholder="Folder name"
          confirm="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            void run(async () => {
              const created = await library.createFolder(name);
              push({ name: 'folder', folderId: created.id });
            });
          }}
        />
      ) : null}
      {dialog?.kind === 'project' ? (
        <NameDialog
          title="New project"
          placeholder="untitled project"
          confirm="Create"
          initial="untitled project"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            void run(async () => {
              const created = await library.createProject(name, route.name === 'folder' ? route.folderId : null);
              push({ name: 'album', albumId: created.id });
            });
          }}
        />
      ) : null}
      {dialog?.kind === 'playlist' ? (
        <NameDialog
          title="New playlist"
          placeholder="Playlist name"
          confirm="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            void run(async () => {
              const created = await library.createPlaylist(name, route.name === 'folder' ? route.folderId : null);
              push({ name: 'album', albumId: created.id });
            });
          }}
        />
      ) : null}
      {dialog?.kind === 'rename-album' ? (
        <NameDialog
          title="Rename"
          placeholder="Name"
          confirm="Save"
          initial={dialog.album.name}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            const id = dialog.album.id;
            setDialog(null);
            void run(() => library.renameAlbum(id, name));
          }}
        />
      ) : null}
      {dialog?.kind === 'rename-folder' ? (
        <NameDialog
          title="Rename folder"
          placeholder="Folder name"
          confirm="Save"
          initial={dialog.folder.name}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            const id = dialog.folder.id;
            setDialog(null);
            void run(() => library.renameFolder(id, name));
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-album' ? (
        <ConfirmDialog
          title={dialog.album.kind === 'playlist' ? 'Delete playlist?' : 'Delete album?'}
          body={
            dialog.album.kind === 'playlist'
              ? 'The playlist goes away. The songs stay in your library.'
              : 'This removes the album and its songs from this phone.'
          }
          confirm="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.album.id;
            setDialog(null);
            void run(() => library.deleteAlbum(id));
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-folder' ? (
        <ConfirmDialog
          title="Delete folder?"
          body="Albums inside move back to your library."
          confirm="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.folder.id;
            setDialog(null);
            void run(() => library.deleteFolder(id));
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-track' ? (
        <ConfirmDialog
          title="Delete track?"
          body={`“${dialog.track.title}” will be removed from this phone.`}
          confirm="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.track.id;
            setDialog(null);
            void run(() => library.deleteTrack(id));
          }}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <PickerDialog
          title="Move to folder"
          confirm="Move"
          empty="No folders yet"
          choices={[
            { id: 'root', label: 'Library' },
            ...library.folders.map((item) => ({ id: item.id, label: item.name })),
          ]}
          onClose={() => setDialog(null)}
          onConfirm={(ids) => {
            const albumId = dialog.album.id;
            const folderId = ids[0] === 'root' ? null : (ids[0] ?? null);
            setDialog(null);
            void run(() => library.moveAlbum(albumId, folderId));
          }}
        />
      ) : null}
      {dialog?.kind === 'add-playlist' ? (
        <PickerDialog
          title="Add to playlist"
          confirm="Add"
          empty="No playlists yet"
          createLabel="New playlist"
          choices={library.albums
            .filter((item) => item.kind === 'playlist')
            .map((item) => ({ id: item.id, label: item.name, detail: item.artist }))}
          onClose={() => setDialog(null)}
          onCreate={() => setDialog({ kind: 'playlist-for-track', track: dialog.track })}
          onConfirm={(ids) => {
            const trackId = dialog.track.id;
            const playlistId = ids[0];
            setDialog(null);
            if (playlistId) void run(() => library.addTracksToPlaylist(playlistId, [trackId]), 'Added to playlist');
          }}
        />
      ) : null}
      {dialog?.kind === 'playlist-for-track' ? (
        <NameDialog
          title="New playlist"
          placeholder="Playlist name"
          confirm="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            const trackId = dialog.track.id;
            setDialog(null);
            void run(async () => {
              const playlist = await library.createPlaylist(name, null);
              await library.addTracksToPlaylist(playlist.id, [trackId]);
            }, 'Added to playlist');
          }}
        />
      ) : null}
      {dialog?.kind === 'pick-tracks' ? (
        <PickerDialog
          title="Add tracks"
          confirm="Add"
          multiple
          empty="Add songs to your library first"
          choices={library.tracks
            .filter((track) => !library.tracksFor(dialog.playlist).some((item) => item.id === track.id))
            .map((track) => ({ id: track.id, label: track.title, detail: track.artist }))}
          onClose={() => setDialog(null)}
          onConfirm={(ids) => {
            const playlistId = dialog.playlist.id;
            setDialog(null);
            void run(() => library.addTracksToPlaylist(playlistId, ids), `Added ${plural(ids.length, 'track')}`);
          }}
        />
      ) : null}
      </Presence>

      {dragOver ? <div className="drop-overlay">Drop songs to add them to your library</div> : null}
      <Presence show={toast !== null}>{toast ? <div className="toast">{toast}</div> : null}</Presence>
    </div>
  );
}
