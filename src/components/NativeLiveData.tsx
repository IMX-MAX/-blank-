import { useEffect } from 'react';

import { beatsForTrack } from '../lib/beats';
import { glyphMatrix } from '../lib/glyph';
import { loadLyrics } from '../lib/lyrics-load';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';

/**
 * Hands the playback service what it needs to draw lyrics or pulse to the beat for the song that is
 * playing: the synced lyric lines and the beat times. The service keeps its own clock, so both keep
 * moving with the screen off. Renders nothing.
 */
export function NativeLiveData() {
  const { track } = usePlayer();
  const { albums } = useLibrary();
  const { glyphSupported, glyphWaveform, glyphMode, vibrateSupported, vibrate, cacheLyrics } = useSettings();
  const glyphOn = glyphSupported && glyphWaveform;
  const wantLyrics = glyphOn && glyphMode === 'lyrics';
  const wantBeats = (glyphOn && glyphMode === 'pulse') || (vibrateSupported && vibrate);
  const trackId = track?.id;
  const title = track?.title;
  const artist = track?.artist;
  const durationMs = track?.durationMs ?? 0;
  const audioFileId = track?.audioFileId;
  const albumName = albums.find((item) => item.id === track?.albumId)?.name;

  useEffect(() => {
    if (!glyphMatrix || !trackId || !title || !wantLyrics) return;
    const controller = new AbortController();
    loadLyrics({ id: trackId, title, artist: artist ?? '', durationMs }, albumName, controller.signal, cacheLyrics)
      .then((result) => {
        if (controller.signal.aborted) return;
        const lines =
          result.status === 'found' && result.lyrics.mode !== 'plain'
            ? result.lyrics.lines.map((line) => ({ start: line.start, end: line.end, text: line.text }))
            : [];
        return glyphMatrix?.setTrackData({ trackId, lines });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [trackId, title, artist, durationMs, albumName, wantLyrics, cacheLyrics]);

  useEffect(() => {
    if (!glyphMatrix || !trackId || !audioFileId || !wantBeats) return;
    const controller = new AbortController();
    beatsForTrack({ audioFileId }, controller.signal)
      .then((beats) => {
        if (controller.signal.aborted) return;
        return glyphMatrix?.setTrackData({
          trackId,
          beatTimes: beats.map((beat) => beat.time),
          beatStrengths: beats.map((beat) => beat.strength),
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [trackId, audioFileId, wantBeats]);

  return null;
}
