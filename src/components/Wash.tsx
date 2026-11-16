import { useEffect, useRef, useState } from 'react';
import { coverObjectUrl } from '../api';

/** Canvas pixels across. The wash is blurred far past this resolution, so a small canvas stretched up is smooth. */
const WIDTH = 96;

/**
 * The player's artwork wash: the cover, zoomed and blurred into soft colour, drawn into a small canvas that CSS
 * stretches over the screen.
 *
 * This used to be the cover image with `filter: blur(150px)` on an element 170% of the screen. On phones Chromium
 * has to rasterise that as one GPU texture (screen size times device pixel ratio, plus three blur radii on every
 * side), which is past the GPU's texture limit, so it clipped the filtered layer and the top and bottom of the
 * screen showed the black page behind it. Blurring 96 pixels in a canvas looks the same and costs almost nothing.
 */
export function Wash({
  fileId,
  hue,
  className,
  blur = 150,
  spread = 0.35,
}: {
  fileId?: string | null;
  hue?: number | null;
  className?: string;
  /** Blur radius in CSS pixels, as `filter: blur()` would take. */
  blur?: number;
  /** How far the zoomed cover reaches past each edge, as a share of the screen. */
  spread?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    setImage(null);
    if (!fileId) return;
    let cancelled = false;
    coverObjectUrl(fileId)
      .then((url) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (!cancelled) setImage(img);
        };
        img.src = url;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const box = canvas.getBoundingClientRect();
      const W = box.width || window.innerWidth;
      const H = box.height || window.innerHeight;
      const cw = WIDTH;
      const ch = Math.max(1, Math.round((WIDTH * H) / W));
      const k = cw / W;
      const radius = blur * k;
      const margin = Math.ceil(radius * 3);
      const off = document.createElement('canvas');
      off.width = cw + margin * 2;
      off.height = ch + margin * 2;
      const o = off.getContext('2d');
      const ctx = canvas.getContext('2d');
      if (!o || !ctx) return;
      o.filter = `blur(${radius}px)`;
      // The cover fills a box (1 + 2 × spread) times the screen, centred, like object-fit: cover.
      const bw = (1 + spread * 2) * W * k;
      const bh = (1 + spread * 2) * H * k;
      const cx = margin + cw / 2;
      const cy = margin + ch / 2;
      if (image && image.naturalWidth) {
        const scale = Math.max(bw / image.naturalWidth, bh / image.naturalHeight);
        const dw = image.naturalWidth * scale;
        const dh = image.naturalHeight * scale;
        o.save();
        o.beginPath();
        o.rect(cx - bw / 2, cy - bh / 2, bw, bh);
        o.clip();
        o.drawImage(image, cx - dw / 2, cy - dh / 2, dw, dh);
        o.restore();
      } else {
        const h = hue ?? 312;
        const g = o.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
        g.addColorStop(0, `hsl(${h} 45% 62%)`);
        g.addColorStop(0.5, `hsl(${h + 15} 40% 46%)`);
        g.addColorStop(1, `hsl(${h + 30} 40% 30%)`);
        o.fillStyle = g;
        o.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      }
      canvas.width = cw;
      canvas.height = ch;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(off, margin, margin, cw, ch, 0, 0, cw, ch);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [image, hue, blur, spread]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
