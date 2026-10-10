import { useEffect, useRef } from 'react';
import { useSettings } from '../state/SettingsProvider';

export function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek: (ratio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const { resolvedTheme } = useSettings();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const style = getComputedStyle(canvas);
      const on = style.getPropertyValue('--wave-on').trim() || 'rgba(240, 240, 240, 0.96)';
      const off = style.getPropertyValue('--wave-off').trim() || 'rgba(196, 196, 196, 0.8)';
      const pitch = 3;
      const barWidth = 2;
      const count = Math.max(8, Math.floor((width + (pitch - barWidth)) / pitch));
      const playhead = Math.min(width - 2, Math.max(0, progress * width));
      for (let i = 0; i < count; i += 1) {
        const from = Math.floor((i / count) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
        let peak = 0;
        for (let j = from; j < to; j += 1) peak = Math.max(peak, peaks[j] ?? 0);
        const barHeight = Math.max(3, (0.28 + peak * 0.72) * (height - 4));
        const x = i * pitch;
        const y = (height - barHeight) / 2;
        ctx.fillStyle = x + barWidth <= playhead ? on : off;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }
      ctx.fillStyle = '#f2d54e';
      ctx.beginPath();
      ctx.roundRect(playhead, 0, 2, height, 1);
      ctx.fill();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, progress, resolvedTheme]);

  function seekAt(clientX: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio);
  }

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekAt(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    />
  );
}
