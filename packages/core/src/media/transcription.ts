// TranscriptionProvider — the boundary to the speech-to-text backend.
// Default is Groq (whisper-large-v3-turbo): the cheapest reliable Whisper host.
// OpenAI whisper-1 is the fallback; a stub is used locally / in tests.
//
// Whisper hosts cap upload size (~25MB). Narthex solved this by extracting a
// 16kHz mono WAV in the browser, then byte-chunking it under the cap and
// REASSEMBLING the word timestamps with a cumulative per-chunk time offset. That
// chunk→transcribe→reassemble logic is ported here so it works for any provider.

import type { TranscriptWord } from "./assets";

export interface AudioInput {
  /** Raw audio bytes — expected to be a 16kHz mono PCM WAV from the browser extractor. */
  bytes: Buffer;
  mimeType: string;
  filename?: string;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptWord[];
  durationMs: number | null;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audio: AudioInput): Promise<TranscriptionResult>;
}

/**
 * Restrict a word-timed transcript to a clip window [startMs, endMs). Timestamps
 * stay absolute (the player reports absolute currentTime); a word is kept if it
 * overlaps the window at all. endMs null = to the end.
 */
export function clipTranscript(words: TranscriptWord[], startMs: number, endMs: number | null): TranscriptWord[] {
  const s = startMs / 1000;
  const e = endMs == null ? Infinity : endMs / 1000;
  return words.filter((w) => w.end > s && w.start < e);
}

/**
 * Render a downloadable transcript: word-timed transcripts become `[m:ss]`-prefixed
 * ~10s blocks; otherwise the verbatim text. (Ported from Narthex's downloadTranscript.)
 */
export function formatTranscript(text: string | null, words: TranscriptWord[] | null): string {
  if (!words || words.length === 0) return text ?? "";
  const stamp = (sec: number) => `[${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}]`;
  const lines: string[] = [];
  let blockStart = words[0]!.start;
  let buf: string[] = [];
  for (const w of words) {
    if (w.start - blockStart >= 10 && buf.length) {
      lines.push(`${stamp(blockStart)} ${buf.join(" ")}`);
      buf = [];
      blockStart = w.start;
    }
    buf.push(w.word);
  }
  if (buf.length) lines.push(`${stamp(blockStart)} ${buf.join(" ")}`);
  return lines.join("\n");
}

// ─── WAV chunking + reassembly (ported from Narthex transcribe fn) ───────────

/**
 * Max bytes per transcription request. NOT just the 25MB file cap — Groq truncates
 * a single long request's output (a 10-min/~19MB file came back cut off at ~5:27).
 * So we chunk to ~4 minutes of 16kHz mono 16-bit PCM (≈8MB) and reassemble with
 * per-chunk timestamp offsets, which keeps each request short enough to fully
 * transcribe. (16000 samples/s × 2 bytes × 240s ≈ 7.68MB.)
 */
export const MAX_WHISPER_BYTES = 8 * 1024 * 1024;

interface WavFmt {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

/** Parse a canonical PCM WAV header, locating the fmt + data subchunks. */
function parseWav(buf: Buffer): WavFmt {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let off = 12;
  let fmt: { numChannels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let data: { offset: number; length: number } | undefined;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { offset: body, length: size };
      break; // data is last in canonical WAV; stop so we don't walk past it
    }
    off = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error("WAV missing fmt or data chunk");
  return { ...fmt, dataOffset: data.offset, dataLength: data.length };
}

/** Build a 44-byte canonical PCM WAV header for a data payload of `dataLength`. */
function wavHeader(f: { numChannels: number; sampleRate: number; bitsPerSample: number; dataLength: number }): Buffer {
  const blockAlign = (f.numChannels * f.bitsPerSample) / 8;
  const byteRate = f.sampleRate * blockAlign;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + f.dataLength, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(f.numChannels, 22);
  h.writeUInt32LE(f.sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(f.bitsPerSample, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(f.dataLength, 40);
  return h;
}

interface WavChunk {
  wav: Buffer;
  /** PCM payload length (bytes) of this chunk — used to offset the next chunk's timestamps. */
  dataLength: number;
}

/** Split a WAV into ≤maxBytes pieces on frame boundaries, each a valid standalone WAV. */
export function splitWav(buf: Buffer, maxBytes = MAX_WHISPER_BYTES): { chunks: WavChunk[]; fmt: WavFmt } {
  const fmt = parseWav(buf);
  const blockAlign = (fmt.numChannels * fmt.bitsPerSample) / 8;
  if (buf.length <= maxBytes) {
    return { chunks: [{ wav: buf, dataLength: fmt.dataLength }], fmt };
  }
  const maxData = Math.floor((maxBytes - 44) / blockAlign) * blockAlign; // frame-aligned
  const chunks: WavChunk[] = [];
  for (let pos = 0; pos < fmt.dataLength; pos += maxData) {
    const len = Math.min(maxData, fmt.dataLength - pos);
    const pcm = buf.subarray(fmt.dataOffset + pos, fmt.dataOffset + pos + len);
    const header = wavHeader({ ...fmt, dataLength: len });
    chunks.push({ wav: Buffer.concat([header, pcm]), dataLength: len });
  }
  return { chunks, fmt };
}

/**
 * Transcribe arbitrarily long audio: split under the cap, transcribe each chunk,
 * then reassemble — shifting every chunk's word timestamps by the cumulative
 * duration of the chunks before it (seconds = bytes / (sampleRate * blockAlign)).
 */
export async function transcribeChunked(
  provider: TranscriptionProvider,
  audio: AudioInput,
  maxBytes = MAX_WHISPER_BYTES,
): Promise<TranscriptionResult> {
  const { chunks, fmt } = splitWav(audio.bytes, maxBytes);
  const blockAlign = (fmt.numChannels * fmt.bitsPerSample) / 8;

  const texts: string[] = [];
  const words: TranscriptWord[] = [];
  let offsetSec = 0;
  for (const chunk of chunks) {
    const res = await provider.transcribe({ ...audio, bytes: chunk.wav });
    texts.push(res.text);
    for (const w of res.words) words.push({ word: w.word, start: w.start + offsetSec, end: w.end + offsetSec });
    offsetSec += chunk.dataLength / (fmt.sampleRate * blockAlign);
  }
  return { text: texts.join(" ").trim(), words, durationMs: Math.round(offsetSec * 1000) };
}

// ─── Providers ───────────────────────────────────────────────────────────────

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}
interface WhisperResponse {
  text: string;
  words?: WhisperWord[];
  duration?: number;
}

/** OpenAI-compatible Whisper endpoint (Groq and OpenAI share this shape). */
async function whisperHttp(
  baseUrl: string,
  apiKey: string,
  model: string,
  audio: AudioInput,
): Promise<TranscriptionResult> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType || "audio/wav" });
  form.append("file", blob, audio.filename ?? "audio.wav");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const res = await fetch(baseUrl, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok) throw new Error(`transcription failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as WhisperResponse;
  return {
    text: json.text ?? "",
    words: (json.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    durationMs: json.duration != null ? Math.round(json.duration * 1000) : null,
  };
}

class GroqTranscription implements TranscriptionProvider {
  readonly name = "groq";
  constructor(private readonly apiKey: string) {}
  transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    return whisperHttp(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      this.apiKey,
      "whisper-large-v3-turbo",
      audio,
    );
  }
}

class OpenAITranscription implements TranscriptionProvider {
  readonly name = "openai";
  constructor(private readonly apiKey: string) {}
  transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    return whisperHttp("https://api.openai.com/v1/audio/transcriptions", this.apiKey, "whisper-1", audio);
  }
}

/** Local stub: a fixed transcript so the pipeline + UI can run with no network. */
class StubTranscription implements TranscriptionProvider {
  readonly name = "stub";
  async transcribe(): Promise<TranscriptionResult> {
    const words = "This is a sample transcript generated locally for development".split(" ");
    return {
      text: words.join(" ") + ".",
      words: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.45 })),
      durationMs: words.length * 500,
    };
  }
}

let cached: TranscriptionProvider | undefined;

/** Active transcription provider: Groq → OpenAI → stub, by which key is present. */
export function getTranscription(): TranscriptionProvider {
  if (cached) return cached;
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const stub = process.env.MEDIA_STUB === "1";
  cached = stub
    ? new StubTranscription()
    : groq
      ? new GroqTranscription(groq)
      : openai
        ? new OpenAITranscription(openai)
        : new StubTranscription();
  return cached;
}
