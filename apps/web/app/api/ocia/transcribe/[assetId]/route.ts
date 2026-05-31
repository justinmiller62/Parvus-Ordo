import { NextResponse } from "next/server";
import {
  getAsset,
  getTranscription,
  setTranscript,
  setTranscriptionStatus,
  transcribeChunked,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Whisper chunking uses Node Buffer; keep this off the edge runtime.
export const runtime = "nodejs";
// A long talk's audio can take a while to transcribe.
export const maxDuration = 300;

// Accepts the browser-extracted 16kHz mono WAV and runs it through the
// transcription provider (Groq by default). Business logic — chunk → transcribe →
// reassemble → persist — lives in packages/core; this is just the entry shim
// (CLAUDE.md §5). Out-of-band in prod: an infra/workers Queue consumer calls the
// same core function.
export async function POST(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const asset = await getAsset(parishId, assetId);
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "empty audio" }, { status: 400 });

  await setTranscriptionStatus({ parishId, id: assetId, status: "processing" });
  try {
    const result = await transcribeChunked(getTranscription(), { bytes, mimeType: "audio/wav", filename: "audio.wav" });
    await setTranscript({
      parishId,
      id: assetId,
      text: result.text,
      words: result.words,
      durationMs: result.durationMs ?? undefined,
    });
    return NextResponse.json({ ok: true, words: result.words.length });
  } catch (err) {
    await setTranscriptionStatus({
      parishId,
      id: assetId,
      status: "failed",
      error: err instanceof Error ? err.message : "transcription failed",
    });
    return NextResponse.json({ error: "transcription failed" }, { status: 500 });
  }
}
