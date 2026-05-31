// Extract audio from a video File in the browser → 16kHz mono 16-bit PCM WAV.
// This is exactly the input our Groq/Whisper chunker expects, and it's ~1.9MB/min
// (tiny vs. the video), so it uploads fast and stays well within request limits.
// Ported from Narthex (apps/web/src/lib/extract-audio.ts).

export async function extractAudioWav(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();

  // Decode the file's audio track (a throwaway context just to decode).
  const decodeCtx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);

  // Resample to 16kHz mono.
  const sampleRate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  return encodeWav(rendered);
}

function encodeWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));

  return new Blob([buffer], { type: "audio/wav" });
}
