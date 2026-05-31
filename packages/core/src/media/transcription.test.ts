import { describe, expect, it } from "vitest";
import { MAX_WHISPER_BYTES, splitWav, transcribeChunked, type TranscriptionProvider } from "./transcription";

// Build a canonical 16kHz mono 16-bit PCM WAV with `dataBytes` of (zeroed) audio.
function makeWav(dataBytes: number): Buffer {
  const sampleRate = 16000;
  const blockAlign = 2; // mono * 16-bit
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([h, Buffer.alloc(dataBytes)]);
}

// A provider that returns a single word at local time 0 per chunk — so the only
// thing that can move a timestamp is the reassembly offset.
function fakeProvider(): TranscriptionProvider {
  let n = 0;
  return {
    name: "fake",
    async transcribe() {
      const id = n++;
      return { text: `chunk${id}`, words: [{ word: `w${id}`, start: 0, end: 0.1 }], durationMs: null };
    },
  };
}

describe("splitWav", () => {
  it("returns a single chunk when under the cap", () => {
    const { chunks } = splitWav(makeWav(32000)); // 1s, well under 24MB
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.dataLength).toBe(32000);
  });

  it("splits on frame boundaries when over the cap, each a valid WAV", () => {
    // 32000 data bytes (1s); force a 0.5s cap → two equal chunks.
    const { chunks } = splitWav(makeWav(32000), 44 + 16000);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.dataLength)).toEqual([16000, 16000]);
    for (const c of chunks) {
      expect(c.wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(c.wav.readUInt32LE(40)).toBe(c.dataLength); // header data size matches payload
    }
  });

  it("uses a sane cap by default", () => {
    expect(MAX_WHISPER_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe("transcribeChunked", () => {
  it("does not offset a single-chunk transcript", async () => {
    const res = await transcribeChunked(fakeProvider(), { bytes: makeWav(32000), mimeType: "audio/wav" });
    expect(res.words).toEqual([{ word: "w0", start: 0, end: 0.1 }]);
    expect(res.text).toBe("chunk0");
  });

  it("offsets each chunk's word timestamps by cumulative duration", async () => {
    // 1s of audio, forced into two 0.5s chunks → 2nd chunk's words shift +0.5s.
    const res = await transcribeChunked(fakeProvider(), { bytes: makeWav(32000), mimeType: "audio/wav" }, 44 + 16000);
    expect(res.words[0]!.start).toBe(0);
    expect(res.words[1]!.start).toBeCloseTo(0.5, 5);
    expect(res.durationMs).toBe(1000);
    expect(res.text).toBe("chunk0 chunk1");
  });
});
