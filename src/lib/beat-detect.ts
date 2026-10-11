export type Beat = { time: number; strength: number };

const HOP = 512;
const MIN_GAP_SECONDS = 0.3;

/**
 * Finds the hits in a song (kick drums and other sharp attacks) with a plain energy-flux onset detector:
 * the low end counts most, the full signal counts a little, and a hit has to stand out from the last
 * second or so around it. Times are seconds, strength is 0.3 to 1.
 */
export function detectBeats(samples: Float32Array, sampleRate: number): Beat[] {
  const buckets = Math.floor(samples.length / HOP);
  if (buckets < 12) return [];
  const low = new Float32Array(buckets);
  const full = new Float32Array(buckets);
  const smoothing = 1 - Math.exp((-2 * Math.PI * 160) / sampleRate);
  let filtered = 0;
  for (let b = 0; b < buckets; b += 1) {
    let lowSum = 0;
    let fullSum = 0;
    const end = (b + 1) * HOP;
    for (let i = b * HOP; i < end; i += 1) {
      const x = samples[i]!;
      filtered += smoothing * (x - filtered);
      lowSum += filtered * filtered;
      fullSum += x * x;
    }
    low[b] = lowSum / HOP;
    full[b] = fullSum / HOP;
  }

  const frames = buckets - 1;
  const lowLevel = compress(low, frames);
  const fullLevel = compress(full, frames);
  const flux = new Float32Array(frames);
  let lowMean = 1e-6;
  let fullMean = 1e-6;
  const lowFlux = new Float32Array(frames);
  const fullFlux = new Float32Array(frames);
  for (let h = 1; h < frames; h += 1) {
    lowFlux[h] = Math.max(0, lowLevel[h]! - lowLevel[h - 1]!);
    fullFlux[h] = Math.max(0, fullLevel[h]! - fullLevel[h - 1]!);
    lowMean += lowFlux[h]!;
    fullMean += fullFlux[h]!;
  }
  lowMean /= frames;
  fullMean /= frames;
  for (let h = 1; h < frames; h += 1) flux[h] = lowFlux[h]! / lowMean + 0.6 * (fullFlux[h]! / fullMean);

  const window = Math.round(1 / ((HOP * 1) / sampleRate));
  const prefix = new Float64Array(frames + 1);
  for (let h = 0; h < frames; h += 1) prefix[h + 1] = prefix[h]! + flux[h]!;

  const hits: Array<{ frame: number; value: number }> = [];
  const minGap = Math.round(MIN_GAP_SECONDS / (HOP / sampleRate));
  for (let h = 2; h < frames - 2; h += 1) {
    const value = flux[h]!;
    if (value < flux[h - 1]! || value < flux[h + 1]! || value < flux[h - 2]! || value < flux[h + 2]!) continue;
    const from = Math.max(0, h - window);
    const to = Math.min(frames, h + window);
    const localMean = (prefix[to]! - prefix[from]!) / (to - from);
    if (value < localMean * 1.6 + 0.6) continue;
    const last = hits[hits.length - 1];
    if (last && h - last.frame < minGap) {
      if (value > last.value) hits[hits.length - 1] = { frame: h, value };
      continue;
    }
    hits.push({ frame: h, value });
  }
  if (!hits.length) return [];

  const sorted = hits.map((hit) => hit.value).sort((a, b) => a - b);
  const reference = sorted[Math.floor((sorted.length - 1) * 0.97)]!;
  return hits.map((hit) => ({
    time: ((hit.frame + 1) * HOP + HOP * 0.4) / sampleRate,
    strength: Math.min(1, Math.max(0.3, hit.value / reference)),
  }));
}

/** Log-compressed energy per frame, relative to the song's own average so quiet and loud masters behave alike. */
function compress(bucketEnergy: Float32Array, frames: number): Float32Array {
  const energy = new Float32Array(frames);
  let mean = 1e-12;
  for (let h = 0; h < frames; h += 1) {
    energy[h] = bucketEnergy[h]! + bucketEnergy[h + 1]!;
    mean += energy[h]!;
  }
  mean /= frames;
  for (let h = 0; h < frames; h += 1) energy[h] = Math.log1p((8 * energy[h]!) / mean);
  return energy;
}
