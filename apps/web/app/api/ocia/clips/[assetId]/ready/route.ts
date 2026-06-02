import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getAssetParishId, updateAssetStatus } from "@parvaordo/core";

export const runtime = "nodejs";

// Constant-time comparison of the shared secret. Hashing both sides to a fixed-width
// SHA-256 digest keeps timingSafeEqual on equal-length buffers (it throws otherwise)
// and avoids leaking the secret's length through an early size mismatch.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Callback hit by the clip cut-service (Cloudflare Container) when a clip finishes
// (or fails). Authenticated by a shared secret since it isn't a logged-in user.
// The owning parish is derived from the asset row (po-k92), so the RLS-scoped update
// lands on the right tenant without trusting the caller to supply it.
export async function POST(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;

  // Fail closed. The old guard (`if (secret && header !== secret)`) skipped the check
  // whenever CLIP_CALLBACK_SECRET was unset, leaving this endpoint public — anyone
  // could flip an asset to ready/failed and inject attacker-chosen playback/poster
  // URLs into the player. A missing secret is a deploy misconfiguration, so reject
  // loudly (500); otherwise require a constant-time-matching header on every request.
  const secret = process.env.CLIP_CALLBACK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "callback secret not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-clip-secret");
  if (!provided || !secretsMatch(provided, secret)) {
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
  // Derive the parish from the asset row itself rather than trusting body.parishId
  // (po-k92): `assets` is RLS-scoped, so getAssetParishId uses a SECURITY DEFINER lookup
  // to find the true owner. Unknown asset → 404. A body.parishId that disagrees with the
  // real owner signals a buggy/compromised cutter job: log it, but proceed against the
  // authoritative parish (the old code silently no-op'd against the wrong tenant instead).
  const parishId = await getAssetParishId(assetId);
  if (!parishId) return NextResponse.json({ error: "asset not found" }, { status: 404 });
  if (body.parishId && body.parishId !== parishId) {
    console.warn(
      `clip callback parishId mismatch for asset ${assetId}: body=${body.parishId} actual=${parishId}; using actual`,
    );
  }

  await updateAssetStatus({
    parishId,
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
