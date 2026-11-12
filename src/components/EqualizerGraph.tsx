import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { BAND_LIMIT, EQ_FREQUENCIES, clampBand, formatDb, formatHz, responseDb } from '../lib/equaliser';

const W = 340;
const H = 170;
const TOP = 14;
const BOTTOM = H - 22;

const MIDDLE = (TOP + BOTTOM) / 2;
const LEFT = 14;
const RIGHT = W - 14;
const F_MIN = 20;
const F_MAX = 20000;
/** The graph shows a little more than a band can do, so the preamp and overlapping bands still fit. */
const SPAN = BAND_LIMIT;

const xFor = (hz: number) => LEFT + ((Math.log10(hz) - Math.log10(F_MIN)) / (Math.log10(F_MAX) - Math.log10(F_MIN))) * (RIGHT - LEFT);
const yFor = (db: number) => MIDDLE - (Math.max(-SPAN, Math.min(SPAN, db)) / SPAN) * ((BOTTOM - TOP) / 2);
const dbFor = (y: number) => ((MIDDLE - y) / ((BOTTOM - TOP) / 2)) * SPAN;

/** The equaliser's real response, drawn from the same filter maths as playback, with a draggable point per band. */
export function EqualizerGraph({
  bands,
  preamp,
  enabled,
  onBand,
}: {
  bands: number[];
  preamp: number;
  enabled: boolean;
  onBand: (band: number, value: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);

  const path = useMemo(() => {
    const points: string[] = [];
    for (let i = 0; i <= 120; i += 1) {
      const hz = F_MIN * (F_MAX / F_MIN) ** (i / 120);
      points.push(`${i ? 'L' : 'M'} ${xFor(hz).toFixed(1)} ${yFor(responseDb(bands, preamp, hz)).toFixed(1)}`);
    }
    return points.join(' ');
  }, [bands, preamp]);

  const move = (event: PointerEvent) => {
    const band = dragging.current;
    const box = svg.current?.getBoundingClientRect();
    if (band === null || !box) return;
    const db = clampBand(dbFor(((event.clientY - box.top) / box.height) * H) - preamp);
    if (db !== bands[band]) onBand(band, db);
  };

  const keyDown = (band: number, event: KeyboardEvent) => {
    const step = event.key === 'ArrowUp' ? 0.5 : event.key === 'ArrowDown' ? -0.5 : 0;
    if (!step) return;
    event.preventDefault();
    onBand(band, clampBand(bands[band]! + step));
  };

  const stop = () => {
    dragging.current = null;
  };

  return (
    <svg
      ref={svg}
      className={enabled ? 'eq-graph' : 'eq-graph off'}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Equaliser curve"
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {[-12, -6, 0, 6, 12].map((db) => (
        <g key={db}>
          <line className={db === 0 ? 'eq-zero' : 'eq-grid'} x1={LEFT} x2={RIGHT} y1={yFor(db)} y2={yFor(db)} />
        </g>
      ))}
      {EQ_FREQUENCIES.map((hz) => (
        <line key={hz} className="eq-grid v" x1={xFor(hz)} x2={xFor(hz)} y1={TOP} y2={BOTTOM} />
      ))}
      <path className="eq-fill" d={`${path} L ${RIGHT} ${MIDDLE} L ${LEFT} ${MIDDLE} Z`} />
      <path className="eq-line" d={path} />
      {EQ_FREQUENCIES.map((hz, band) => (
        <g key={hz}>
          <circle
            className="eq-handle"
            cx={xFor(hz)}
            cy={yFor(bands[band]! + preamp)}
            r={7.5}
            role="slider"
            tabIndex={0}
            aria-label={`${formatHz(hz)}Hz`}
            aria-orientation="vertical"
            aria-valuemin={-BAND_LIMIT}
            aria-valuemax={BAND_LIMIT}
            aria-valuenow={bands[band]}
            aria-valuetext={formatDb(bands[band]!)}
            onKeyDown={(event) => keyDown(band, event)}
            onPointerDown={(event) => {
              dragging.current = band;
              (event.target as Element).setPointerCapture(event.pointerId);
            }}
          />
          <text className="eq-label" x={xFor(hz)} y={H - 5} textAnchor="middle">
            {formatHz(hz)}
          </text>
        </g>
      ))}
    </svg>
  );
}
