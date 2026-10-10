import { useEffect, useRef } from 'react';

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
      const gap = 1.5;
      const count = Math.max(peaks.length, 1);
      const barWidth = Math.max(1, (width - (count - 1) * gap) / count);
      for (let i = 0; i < count; i += 1) {
        const peak = peaks[i] ?? 0.2;
        const barHeight = Math.max(2, peak * (height - 6));
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = 'rgba(214, 214, 214, 0.88)';
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(1, barWidth - 0.4), barHeight, 1);
        ctx.fill();
      }
      const playhead = Math.min(width - 1, Math.max(0, progress * width));
      ctx.fillStyle = '#e6c84a';
      ctx.fillRect(playhead, 2, 2, height - 4);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, progress]);

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
