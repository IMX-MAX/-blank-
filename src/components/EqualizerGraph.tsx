import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { clampBand, EQ_LIMIT, type EqBands } from '../lib/audio-engine';

const W = 300;
const H = 160;
const TOP = 18;
const BOTTOM = H - 18;
const MIDDLE = (TOP + BOTTOM) / 2;

const BANDS: Array<{ key: keyof EqBands; label: string; x: number }> = [
  { key: 'bass', label: 'Bass', x: 50 },
  { key: 'mid', label: 'Mid', x: 150 },
  { key: 'treble', label: 'Treble', x: 250 },
];

const yFor = (db: number) => MIDDLE - (db / EQ_LIMIT) * ((BOTTOM - TOP) / 2);
const dbFor = (y: number) => clampBand(((MIDDLE - y) / ((BOTTOM - TOP) / 2)) * EQ_LIMIT);
const format = (db: number) => `${db > 0 ? '+' : ''}${db} dB`;

function curve(bands: EqBands): string {
  const points = [
    { x: 0, y: yFor(bands.bass) },
    ...BANDS.map((band) => ({ x: band.x, y: yFor(bands[band.key]) })),
    { x: W, y: yFor(bands.treble) },
  ];
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const half = (to.x - from.x) / 2;
    path += ` C ${from.x + half} ${from.y} ${to.x - half} ${to.y} ${to.x} ${to.y}`;
  }
  return path;
}

/** Three draggable points, bass, mid and treble, on a line that is the equaliser's shape. */
export function EqualizerGraph({ value, onChange }: { value: EqBands; onChange: (next: EqBands) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<keyof EqBands | null>(null);

  const move = (event: PointerEvent) => {
    const key = dragging.current;
    const box = svg.current?.getBoundingClientRect();
    if (!key || !box) return;
    const y = ((event.clientY - box.top) / box.height) * H;
    const db = dbFor(y);
    if (db !== value[key]) onChange({ ...value, [key]: db });
  };

  const keyDown = (key: keyof EqBands, event: KeyboardEvent) => {
    const step = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    onChange({ ...value, [key]: clampBand(value[key] + step) });
  };

  return (
    <svg
      ref={svg}
      className="eq-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Equalizer"
      onPointerMove={move}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
    >
      {[-EQ_LIMIT, -EQ_LIMIT / 2, 0, EQ_LIMIT / 2, EQ_LIMIT].map((db) => (
        <line key={db} className={db === 0 ? 'eq-zero' : 'eq-grid'} x1={0} x2={W} y1={yFor(db)} y2={yFor(db)} />
      ))}
      <path className="eq-fill" d={`${curve(value)} L ${W} ${MIDDLE} L 0 ${MIDDLE} Z`} />
      <path className="eq-line" d={curve(value)} />
      {BANDS.map((band) => (
        <g key={band.key}>
          <circle
            className="eq-handle"
            cx={band.x}
            cy={yFor(value[band.key])}
            r={11}
            role="slider"
            tabIndex={0}
            aria-label={band.label}
            aria-orientation="vertical"
            aria-valuemin={-EQ_LIMIT}
            aria-valuemax={EQ_LIMIT}
            aria-valuenow={value[band.key]}
            aria-valuetext={format(value[band.key])}
            onKeyDown={(event) => keyDown(band.key, event)}
            onPointerDown={(event) => {
              dragging.current = band.key;
              (event.target as Element).setPointerCapture(event.pointerId);
            }}
          />
          <text className="eq-label" x={band.x} y={H - 3} textAnchor="middle">
            {band.label}
          </text>
          <text className="eq-value" x={band.x} y={Math.min(BOTTOM - 4, Math.max(TOP + 2, yFor(value[band.key]) + (value[band.key] >= 0 ? -17 : 25)))} textAnchor="middle">
            {format(value[band.key])}
          </text>
        </g>
      ))}
    </svg>
  );
}
