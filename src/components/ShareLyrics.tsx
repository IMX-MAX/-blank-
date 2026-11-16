import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, Copy, Share2 } from 'lucide-react';
import { coverObjectUrl } from '../api';
import { successHaptic, tickHaptic } from '../lib/haptics';
import { drawShareCard, shareFontsReady, SHARE_SIZES, SHARE_STYLES, type ShareFormat } from '../lib/share-card';
import { copyText, shareCardImage } from '../lib/share-export';
import { lyricsText } from '../lib/share-layout';

const STYLE_KEY = 'blank.shareStyle';
const FORMAT_KEY = 'blank.shareFormat';

function useImage(fileId: string | null): { image: HTMLImageElement | null; ready: boolean } {
  const [state, setState] = useState<{ image: HTMLImageElement | null; ready: boolean }>({ image: null, ready: !fileId });
  useEffect(() => {
    if (!fileId) {
      setState({ image: null, ready: true });
      return;
    }
    let cancelled = false;
    setState({ image: null, ready: false });
    coverObjectUrl(fileId)
      .then(
        (url) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = url;
          }),
      )
      .then((image) => !cancelled && setState({ image, ready: true }))
      .catch(() => !cancelled && setState({ image: null, ready: true }));
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return state;
}

/**
 * Share chosen lyric lines as an image: a card with the cover, title and artist, the lines and the app's name, in
 * a few styles you swipe between, as a story (9:16) or a square. The preview is the exported PNG itself.
 */
export function ShareLyricsSheet({
  title,
  artist,
  lines,
  coverFileId,
  hue,
  onBack,
  onDone,
}: {
  title: string;
  artist: string;
  lines: string[];
  coverFileId: string | null;
  hue: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { image, ready } = useImage(coverFileId);
  const [fontsReady, setFontsReady] = useState(false);
  const [styleIndex, setStyleIndex] = useState(() => Math.max(0, SHARE_STYLES.findIndex((item) => item.id === localStorage.getItem(STYLE_KEY))));
  const [format, setFormat] = useState<ShareFormat>(() => (localStorage.getItem(FORMAT_KEY) === 'square' ? 'square' : 'story'));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const style = SHARE_STYLES[styleIndex]!.id;
  const text = lyricsText(lines, title, artist);

  useEffect(() => {
    let alive = true;
    void shareFontsReady().finally(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!fontsReady || !ready || !canvasRef.current) return;
    drawShareCard(canvasRef.current, { title, artist, lines, cover: image, hue, style, format });
  }, [fontsReady, ready, image, title, artist, lines, hue, style, format]);

  const pickStyle = (index: number) => {
    const next = (index + SHARE_STYLES.length) % SHARE_STYLES.length;
    if (next === styleIndex) return;
    tickHaptic();
    localStorage.setItem(STYLE_KEY, SHARE_STYLES[next]!.id);
    setStyleIndex(next);
  };

  const pickFormat = (next: ShareFormat) => {
    localStorage.setItem(FORMAT_KEY, next);
    setFormat(next);
  };

  const size = SHARE_SIZES[format];

  // Portalled to the body so it sits above the player bar and everything else, whatever it is rendered inside.
  return createPortal(
    <section className="share-lyrics" data-overlay aria-label="Share lyrics">
      <header className="share-head">
        <button className="icon-btn" aria-label="Back to lyrics" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h2>Share lyrics</h2>
        <div className="segmented share-format" role="radiogroup" aria-label="Shape">
          <button role="radio" aria-checked={format === 'story'} className={format === 'story' ? 'on' : ''} onClick={() => pickFormat('story')}>
            Story
          </button>
          <button role="radio" aria-checked={format === 'square'} className={format === 'square' ? 'on' : ''} onClick={() => pickFormat('square')}>
            Square
          </button>
        </div>
      </header>

      <div
        className="share-stage"
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) pickStyle(styleIndex + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <canvas
          ref={canvasRef}
          className={fontsReady && ready ? 'share-canvas ready' : 'share-canvas'}
          width={size.width}
          height={size.height}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
          aria-label={`Lyrics card: ${lines.join(' / ')}`}
          role="img"
        />
      </div>

      <div className="share-styles" role="radiogroup" aria-label="Card style">
        {SHARE_STYLES.map((item, index) => (
          <button
            key={item.id}
            role="radio"
            aria-checked={index === styleIndex}
            className={index === styleIndex ? `share-style ${item.id} on` : `share-style ${item.id}`}
            style={{ ['--hue' as string]: hue }}
            onClick={() => pickStyle(index)}
          >
            <span className="share-swatch" />
            {item.label}
          </button>
        ))}
      </div>
      <p className="share-hint">Swipe the card to change its style</p>
      {error ? <p className="share-error">{error}</p> : null}

      <footer className="share-actions">
        <button
          className="share-copy"
          onClick={() => {
            void copyText(text).then(
              () => {
                successHaptic();
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              },
              () => setError('Could not copy the lyrics'),
            );
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied' : 'Copy text'}
        </button>
        <button
          className="white-btn share-go"
          disabled={busy || !fontsReady || !ready}
          onClick={() => {
            if (!canvasRef.current) return;
            setBusy(true);
            setError(null);
            void shareCardImage(canvasRef.current, title, text)
              .then((shared) => {
                if (shared) {
                  successHaptic();
                  onDone();
                }
              })
              .catch(() => setError('Could not share the image'))
              .finally(() => setBusy(false));
          }}
        >
          <Share2 size={17} /> {busy ? 'Preparing…' : 'Share'}
        </button>
      </footer>
    </section>,
    document.body,
  );
}
