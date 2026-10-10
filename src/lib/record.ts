import { encodeWav } from './wav';

export type RecorderHandle = {
  stop: () => File;
  cancel: () => void;
};

export async function startRecorder(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot record audio');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const sampleRate = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);

  let closed = false;
  const finish = () => {
    if (closed) return new Float32Array();
    closed = true;
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void ctx.close();
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return samples;
  };

  return {
    cancel() {
      finish();
    },
    stop() {
      const samples = finish();
      const blob = encodeWav(samples, sampleRate);
      const stamp = new Date().toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      return new File([blob], `Recording ${stamp}.wav`, { type: 'audio/wav' });
    },
  };
}
