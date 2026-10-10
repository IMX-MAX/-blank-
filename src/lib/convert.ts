import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function engine(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  if (!loading) {
    const pending = (async () => {
      const instance = new FFmpeg();
      await instance.load({
        coreURL: await toBlobURL(coreURL, 'text/javascript'),
        wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      });
      ffmpeg = instance;
      return instance;
    })();
    loading = pending;
  }
  try {
    return await loading;
  } catch (err) {
    loading = null;
    ffmpeg = null;
    throw err;
  }
}

function baseName(name: string): string {
  const trimmed = name.replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, ' ').trim();
  return (trimmed || 'Converted').slice(0, 80);
}

export async function videoToAudio(file: File): Promise<File> {
  const ffmpegEngine = await engine();
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const input = `in.${ext}`;
  await ffmpegEngine.writeFile(input, await fetchFile(file));

  const mp3 = await render(ffmpegEngine, input, 'out.mp3', ['-vn', '-acodec', 'libmp3lame', '-q:a', '2', 'out.mp3']);
  if (mp3) {
    await ffmpegEngine.deleteFile(input).catch(() => undefined);
    return new File([toArrayBuffer(mp3)], `${baseName(file.name)}.mp3`, { type: 'audio/mpeg' });
  }

  const wav = await render(ffmpegEngine, input, 'out.wav', ['-vn', '-acodec', 'pcm_s16le', 'out.wav']);
  await ffmpegEngine.deleteFile(input).catch(() => undefined);
  if (!wav) throw new Error('Could not pull audio out of that video');
  return new File([toArrayBuffer(wav)], `${baseName(file.name)}.wav`, { type: 'audio/wav' });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function render(ffmpegEngine: FFmpeg, input: string, output: string, args: string[]): Promise<Uint8Array | null> {
  const code = await ffmpegEngine.exec(['-i', input, ...args]);
  if (code !== 0) return null;
  const data = await ffmpegEngine.readFile(output);
  await ffmpegEngine.deleteFile(output).catch(() => undefined);
  if (!(data instanceof Uint8Array) || data.byteLength < 128) return null;
  return new Uint8Array(data);
}
