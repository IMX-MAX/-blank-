const BARS = 140;

export function decorativePeaks(seed: string, bars = BARS): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const peaks: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519);
    const unit = ((hash >>> 0) % 1000) / 1000;
    const shape = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI);
    peaks.push(Math.min(1, (0.18 + unit * 0.82) * shape));
  }
  return peaks;
}

export function readPeaks(raw: string | null | undefined, seed: string): number[] {
  if (!raw) return decorativePeaks(seed);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 8 && parsed.every((n) => typeof n === 'number')) {
      return parsed as number[];
    }
  } catch {
    /* fall through */
  }
  return decorativePeaks(seed);
}

export async function peaksFromFile(file: File, bars = BARS): Promise<number[]> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const channel = audio.getChannelData(0);
    if (channel.length === 0) return decorativePeaks(file.name, bars);
    const block = Math.max(1, Math.floor(channel.length / bars));
    const stride = Math.max(1, Math.floor(block / 80));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i += 1) {
      const start = i * block;
      let max = 0;
      const end = Math.min(channel.length, start + block);
      for (let j = start; j < end; j += stride) {
        const value = Math.abs(channel[j] ?? 0);
        if (value > max) max = value;
      }
      peaks.push(max);
    }
    const loudest = Math.max(...peaks, 0.01);
    return peaks.map((peak) => Math.min(1, peak / loudest));
  } finally {
    await ctx.close();
  }
}

export async function peaksForUpload(file: File): Promise<number[]> {
  try {
    return await Promise.race([
      peaksFromFile(file),
      new Promise<number[]>((resolve) => {
        window.setTimeout(() => resolve(decorativePeaks(file.name)), 8000);
      }),
    ]);
  } catch {
    return decorativePeaks(file.name);
  }
}
