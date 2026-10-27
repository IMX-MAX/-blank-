import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { errorMessage, formatClock } from '../lib/format';
import { saveChosenLyrics } from '../lib/lyrics-cache';
import { previewLines, researchLyrics, RESEARCH_SOURCES, SYNC_LABEL, type ResearchRow, type ResearchSourceId } from '../lib/lyrics-research';
import type { Track } from '../types';
import { Scrim } from './overlays';

type Answers = Partial<Record<ResearchSourceId, ResearchRow[]>>;

const matchedText = (row: ResearchRow): string => {
  const { title, artist, duration } = row.matched ?? {};
  const names = [title, artist].filter(Boolean).join(' \u2013 ');
  const length = duration && duration > 0 ? formatClock(duration) : '';
  return [names, length].filter(Boolean).join(' \u00b7 ');
};

/** Searches every lyrics source for a song at once and lets the user pick which result to keep. */
export function LyricsResearchDialog({
  track,
  album,
  onClose,
  onSaved,
}: {
  track: Track;
  album?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const closed = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setAnswers({});
    void researchLyrics(
      { title: track.title, artist: track.artist ?? '', album, duration: track.durationMs / 1000 },
      {
        signal: controller.signal,
        onSource: (source, rows) => setAnswers((current) => ({ ...current, [source.id]: rows })),
      },
    );
    return () => controller.abort();
  }, [track.id, track.title, track.artist, track.durationMs, album, round]);

  useEffect(
    () => () => {
      closed.current = true;
    },
    [],
  );

  const pick = async (row: ResearchRow) => {
    if (!row.result || saving) return;
    setSaving(row.key);
    setError(null);
    try {
      await saveChosenLyrics(track, row.result);
      onSaved();
    } catch (err) {
      if (!closed.current) {
        setError(errorMessage(err));
        setSaving(null);
      }
    }
  };

  const waiting = RESEARCH_SOURCES.filter((source) => !answers[source.id]).length;

  return (
    <Scrim onClose={onClose}>
      <div className="dialog wide research" role="dialog" aria-label="Re-search lyrics">
        <h2>Re-search lyrics</h2>
        <p>
          {track.title}
          {track.artist ? ` \u00b7 ${track.artist}` : ''}
          {track.durationMs ? ` \u00b7 ${formatClock(track.durationMs / 1000)}` : ''}
        </p>
        <div className="choice-list research-list">
          {RESEARCH_SOURCES.flatMap((source) => {
            const rows = answers[source.id];
            if (!rows) {
              return [
                <div key={`${source.id}:wait`} className="choice research-none" aria-busy>
                  <span>{source.name}</span>
                  <small>Searching&hellip;</small>
                </div>,
              ];
            }
            return rows.map((row) => {
              if (row.status === 'found' && row.result) {
                const lyrics = row.result.lyrics;
                const preview = previewLines(lyrics);
                const matched = matchedText(row);
                return (
                  <button key={row.key} className="choice research-hit" disabled={saving !== null} onClick={() => void pick(row)}>
                    <span className="research-head">
                      <span>{row.name}</span>
                      <span className={`research-chip ${lyrics.mode}`}>{SYNC_LABEL[lyrics.mode]}</span>
                      {saving === row.key ? <Check size={14} /> : null}
                    </span>
                    {matched ? <small>{matched}</small> : null}
                    <small className="research-preview">{preview.join(' / ')}</small>
                  </button>
                );
              }
              return (
                <div key={row.key} className="choice research-none">
                  <span>{row.name}</span>
                  <small className={row.error ? 'source-bad' : undefined}>
                    {row.status === 'instrumental' ? 'Marked instrumental' : 'No result'}
                    {row.error ? ` \u00b7 ${row.error}` : ''}
                  </small>
                </div>
              );
            });
          })}
        </div>
        {error ? <p className="source-bad">{error}</p> : null}
        <div className="dialog-actions">
          {waiting === 0 ? (
            <button className="text-btn" disabled={saving !== null} onClick={() => setRound((n) => n + 1)}>
              Search again
            </button>
          ) : null}
          <button className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Scrim>
  );
}
