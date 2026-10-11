import type { CSSProperties } from 'react';

type SliderProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (value: number) => void;
  className?: string;
};

/** A range input with a filled track, a roomy touch target and a thumb that grows while dragged. */
export function Slider({ value, min, max, step, label, onChange, className }: SliderProps) {
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return (
    <input
      className={className ? `slider ${className}` : 'slider'}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      style={{ '--p': fraction } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
