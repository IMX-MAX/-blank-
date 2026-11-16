import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the image'))), 'image/png'));

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });

const fileName = (title: string) => `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lyrics'}-lyrics.png`;

/**
 * Shares the card as a PNG. On the phone it is written to the app's cache and handed to Android's share sheet;
 * in a browser it uses the Web Share API, or downloads the file. Resolves false when sharing was cancelled.
 */
export async function shareCardImage(canvas: HTMLCanvasElement, title: string, text: string): Promise<boolean> {
  const blob = await toBlob(canvas);
  const name = fileName(title);
  if (Capacitor.isNativePlatform()) {
    const data = await toBase64(blob);
    const written = await Filesystem.writeFile({ path: `share/${name}`, data, directory: Directory.Cache, recursive: true });
    try {
      await Share.share({ title: 'Share lyrics', text, files: [written.uri], dialogTitle: 'Share lyrics' });
      return true;
    } catch (err) {
      if (/cancel/i.test(String((err as Error)?.message ?? err))) return false;
      throw err;
    }
  }
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return false;
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
