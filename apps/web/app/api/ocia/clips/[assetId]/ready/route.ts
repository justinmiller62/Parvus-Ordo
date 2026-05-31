import { NextResponse } from "next/server";
import { updateAssetStatus } from "@parvaordo/core";

export const runtime = "nodejs";

// Callback hit by the clip cut-service (Cloudflare Container) when a clip finishes
// (or fails). Authenticated by a shared secret since it isn't a logged-in user.
// The container supplies the parish (from the job) so the RLS-scoped update works.
export async function POST(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const secret = process.env.CLIP_CALLBACK_SECRET;
  if (secret && req.headers.get("x-clip-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as {
    parishId?: string;
    providerAssetId?: string;
    playbackUrl?: string;
    posterUrl?: string;
    durationMs?: number;
    error?: string;
  };
  if (!body.parishId) return NextResponse.json({ error: "parishId required" }, { status: 400 });

  await updateAssetStatus({
    parishId: body.parishId,
    id: assetId,
    status: body.error ? "failed" : "ready",
    providerAssetId: body.providerAssetId ?? null,
    playbackUrl: body.playbackUrl ?? null,
    posterUrl: body.posterUrl ?? null,
    durationMs: body.durationMs ?? null,
    error: body.error ?? null,
  });
  return NextResponse.json({ ok: true });
}
