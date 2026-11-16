/**
 * Draws the lyric share card onto a canvas at full export size (1080 px wide), so the preview on screen is the
 * very same pixels as the PNG that is shared.
 */
import { fitLyrics } from './share-layout';

export type ShareFormat = 'story' | 'square';
export type ShareStyle = 'artwork' | 'colour' | 'light' | 'black';

export const SHARE_STYLES: { id: ShareStyle; label: string }[] = [
  { id: 'artwork', label: 'Artwork' },
  { id: 'colour', label: 'Colour' },
  { id: 'light', label: 'Light' },
  { id: 'black', label: 'Black' },
];

export const SHARE_SIZES: Record<ShareFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export const DISPLAY_FONT = '"SF Pro Display", "Inter Variable", "Inter", system-ui, sans-serif';
export const TEXT_FONT = '"SF Pro Text", "SF Pro Display", "Inter Variable", "Inter", system-ui, sans-serif';

export type CardInput = {
  title: string;
  artist: string;
  lines: string[];
  cover: HTMLImageElement | null;
  /** Hue to fall back on when there is no cover. */
  hue: number;
  style: ShareStyle;
  format: ShareFormat;
};

/** Waits for the app's fonts, so the canvas does not draw in a fallback face. */
export async function shareFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = 'Aa';
  await Promise.allSettled([
    document.fonts.load(`700 80px ${DISPLAY_FONT}`, sample),
    document.fonts.load(`600 44px ${DISPLAY_FONT}`, sample),
    document.fonts.load(`500 34px ${TEXT_FONT}`, sample),
    document.fonts.load(`700 30px ${DISPLAY_FONT}`, sample),
  ]);
  await document.fonts.ready;
}

type Rgb = { r: number; g: number; b: number };

/** The cover's main colour: an average leaning towards the more colourful pixels. */
export function dominantColour(image: HTMLImageElement | null, hue: number): Rgb {
  if (image) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i]!;
        const pg = data[i + 1]!;
        const pb = data[i + 2]!;
        const max = Math.max(pr, pg, pb);
        const min = Math.min(pr, pg, pb);
        const weight = 0.15 + ((max - min) / 255) ** 1.5 * (max > 40 ? 1 : 0.2);
        r += pr * weight;
        g += pg * weight;
        b += pb * weight;
        total += weight;
      }
      if (total > 0) return { r: r / total, g: g / total, b: b / total };
    } catch {
      // A cover the canvas cannot read falls back to the hue.
    }
  }
  return hslToRgb(hue, 0.55, 0.45);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;

let grainCanvas: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(256, 256);
  // A fixed seed, so the same card always comes out the same.
  let seed = 1234567;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainCanvas = canvas;
  return canvas;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/** Draws `image` to cover the box, cropping the overflow, like object-fit: cover. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function ellipsise(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

type Palette = { text: string; sub: string; mark: string; card: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => void };

function paintBackground(ctx: CanvasRenderingContext2D, input: CardInput, base: Rgb, width: number, height: number): Palette {
  const [h, s] = rgbToHsl(base);
  const sat = Math.min(0.85, Math.max(0.25, s));
  const { cover, style } = input;

  if (style === 'artwork' && cover) {
    ctx.fillStyle = hsl(h, sat, 0.2);
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.filter = 'blur(90px) saturate(1.5)';
    drawCover(ctx, cover, -220, -220, width + 440, height + 440);
    ctx.restore();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, width, height);
  } else if (style === 'light') {
    const gradient = ctx.createLinearGradient(0, 0, width * 0.4, height);
    gradient.addColorStop(0, hsl(h, sat * 0.7, 0.9));
    gradient.addColorStop(1, hsl(h + 25, sat * 0.6, 0.8));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else if (style === 'black') {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.3, 0, width * 0.5, height * 0.3, height * 0.75);
    glow.addColorStop(0, hsl(h, sat, 0.32, 0.55));
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  } else {
    // Colour, and artwork with no cover: a deep gradient of the cover's colour.
    const gradient = ctx.createLinearGradient(0, 0, width * 0.35, height);
    gradient.addColorStop(0, hsl(h - 12, sat, 0.42));
    gradient.addColorStop(1, hsl(h + 18, sat * 0.95, 0.16));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // A soft vignette, then fine grain so the gradients never band.
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.hypot(width, height) * 0.6);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, style === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = style === 'light' ? 0.045 : 0.06;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(grain(), 'repeat')!;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  if (style === 'light') {
    return {
      text: '#111114',
      sub: 'rgba(17, 17, 20, 0.62)',
      mark: 'rgba(17, 17, 20, 0.5)',
      card: (c, x, y, w, hh, r) => {
        c.save();
        c.shadowColor = 'rgba(0, 0, 0, 0.12)';
        c.shadowBlur = 60;
        c.shadowOffsetY = 18;
        rounded(c, x, y, w, hh, r);
        c.fillStyle = 'rgba(255, 255, 255, 0.86)';
        c.fill();
        c.restore();
      },
    };
  }
  return {
    text: '#ffffff',
    sub: 'rgba(255, 255, 255, 0.7)',
    mark: 'rgba(255, 255, 255, 0.55)',
    card: (c, x, y, w, hh, r) => {
      c.save();
      c.shadowColor = 'rgba(0, 0, 0, 0.35)';
      c.shadowBlur = 80;
      c.shadowOffsetY = 24;
      rounded(c, x, y, w, hh, r);
      c.fillStyle = style === 'black' ? 'rgba(22, 22, 22, 0.92)' : style === 'artwork' ? 'rgba(0, 0, 0, 0.3)' : hsl(h + 10, sat * 0.9, 0.1, 0.42);
      c.fill();
      c.restore();
      c.save();
      rounded(c, x + 1, y + 1, w - 2, hh - 2, r - 1);
      c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      c.lineWidth = 2;
      c.stroke();
      c.restore();
    },
  };
}

/** Draws the whole card at export size onto `canvas`. */
export function drawShareCard(canvas: HTMLCanvasElement, input: CardInput): void {
  const { width, height } = SHARE_SIZES[input.format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const base = dominantColour(input.cover, input.hue);
  const palette = paintBackground(ctx, input, base, width, height);
  const story = input.format === 'story';

  const margin = story ? 84 : 64;
  const pad = story ? 72 : 60;
  const cardW = width - margin * 2;
  const inner = cardW - pad * 2;
  const coverSize = story ? 132 : 112;
  const headerH = coverSize;
  const headGap = story ? 68 : 52;
  const footH = 34;
  const footGap = story ? 68 : 48;
  const maxCardH = story ? height - 360 : height - margin * 2;
  const lyricBoxH = maxCardH - pad * 2 - headerH - headGap - footH - footGap;

  ctx.font = `700 80px ${DISPLAY_FONT}`;
  const measure = (text: string, size: number) => {
    ctx.font = `700 ${size}px ${DISPLAY_FONT}`;
    return ctx.measureText(text).width;
  };
  ctx.letterSpacing = '0px';
  const fit = fitLyrics(input.lines, { width: inner, height: lyricBoxH }, measure, story ? { max: 92, min: 44, lineHeight: 1.14, gap: 0.5 } : { max: 76, min: 38, lineHeight: 1.14, gap: 0.45 });

  const cardH = story ? pad * 2 + headerH + headGap + fit.height + footGap + footH : maxCardH;
  const cardX = margin;
  const cardY = Math.round((height - cardH) / 2);
  palette.card(ctx, cardX, cardY, cardW, cardH, story ? 56 : 48);

  // Cover, crisp with rounded corners.
  const cx = cardX + pad;
  const cy = cardY + pad;
  ctx.save();
  rounded(ctx, cx, cy, coverSize, coverSize, coverSize * 0.2);
  ctx.clip();
  if (input.cover) drawCover(ctx, input.cover, cx, cy, coverSize, coverSize);
  else {
    const [h] = rgbToHsl(base);
    const g = ctx.createLinearGradient(cx, cy, cx + coverSize, cy + coverSize);
    g.addColorStop(0, hsl(h, 0.6, 0.55));
    g.addColorStop(1, hsl(h + 40, 0.65, 0.25));
    ctx.fillStyle = g;
    ctx.fillRect(cx, cy, coverSize, coverSize);
  }
  ctx.restore();

  // Title and artist beside it.
  const textX = cx + coverSize + 32;
  const textW = cardX + cardW - pad - textX;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.text;
  ctx.font = `600 ${story ? 44 : 40}px ${DISPLAY_FONT}`;
  ctx.letterSpacing = '-0.5px';
  ctx.fillText(ellipsise(ctx, input.title, textW), textX, cy + coverSize / 2 - 6);
  ctx.fillStyle = palette.sub;
  ctx.font = `500 ${story ? 34 : 31}px ${TEXT_FONT}`;
  ctx.letterSpacing = '0px';
  ctx.fillText(ellipsise(ctx, input.artist || 'Unknown artist', textW), textX, cy + coverSize / 2 + 40);

  // The lyrics, centred in what is left of the card.
  const lyricTop = cy + headerH + headGap;
  const lyricSpace = story ? fit.height : cardH - pad * 2 - headerH - headGap - footGap - footH;
  let y = lyricTop + Math.max(0, (lyricSpace - fit.height) / 2);
  ctx.fillStyle = palette.text;
  ctx.font = `700 ${fit.size}px ${DISPLAY_FONT}`;
  ctx.letterSpacing = `${(-0.022 * fit.size).toFixed(2)}px`;
  ctx.textBaseline = 'top';
  fit.blocks.forEach((block, index) => {
    if (index) y += fit.gap;
    for (const row of block) {
      ctx.fillText(row, cx, y + (fit.lineHeight - fit.size) / 2);
      y += fit.lineHeight;
    }
  });

  // The app's name at the foot of the card.
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '-0.4px';
  ctx.fillStyle = palette.mark;
  ctx.font = `700 ${footH}px ${DISPLAY_FONT}`;
  ctx.fillText('[blank]', cx, cardY + cardH - pad);
}
