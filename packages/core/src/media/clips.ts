// ClipProcessor — cuts a [startMs, endMs] window from a source video into its own
// short video, so the native iOS/Android player only ever sees the clip's length
// (it can't scrub into the rest of the source). Revises Architecture §9.
//
// Local/tests: a stub that marks the clip ready instantly (playback falls back to
// the source — no real cutting offline). Prod: the cut runs in a Cloudflare
// Container (frame-accurate ffmpeg `-ss`/`-to` re-encode → re-upload to Bunny),
// reached over HTTP/Queue; it calls back our API to flip the clip's status. All
// orchestration (which clip, dedup, cleanup, RLS) stays here in core; the container
// holds ZERO business logic — it's a pure transform.

import { getDb } from "../db/client";
import { createAsset, deleteAsset, getAsset, updateAssetStatus, type Asset } from "./assets";
import { getStorage } from "./storage";

export interface ClipJob {
  parishId: string;
  clipAssetId: string;
  source: Asset;
  startMs: number;
  endMs: number | null;
}

export interface ClipProcessor {
  readonly name: string;
  /** Begin cutting an already-created (status='processing') clip asset. */
  process(job: ClipJob): Promise<void>;
}

// ─── Stub (local / tests) ────────────────────────────────────────────────────
// No real cut: the clip is marked ready immediately and plays the source URL.
class StubClipProcessor implements ClipProcessor {
  readonly name = "stub";
  async process(job: ClipJob): Promise<void> {
    const end = job.endMs ?? job.source.durationMs ?? job.startMs;
    await updateAssetStatus({
      parishId: job.parishId,
      id: job.clipAssetId,
      status: "ready",
      playbackUrl: job.source.playbackUrl ?? undefined,
      posterUrl: job.source.posterUrl ?? undefined,
      durationMs: Math.max(0, end - job.startMs),
    });
  }
}

// ─── Prod (Cloudflare Container over HTTP) ───────────────────────────────────
// Fire-and-forget: POST the job to the cut-service, which produces the clip and
// calls back POST /api/ocia/clips/:id/ready to flip status. The clip stays
// 'processing' (gray) until then.
class HttpClipProcessor implements ClipProcessor {
  readonly name = "http";
  constructor(private readonly endpoint: string, private readonly callbackBase: string) {}
  async process(job: ClipJob): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipAssetId: job.clipAssetId,
        parishId: job.parishId,
        sourceProviderAssetId: job.source.providerAssetId,
        startMs: job.startMs,
        endMs: job.endMs,
        callbackUrl: `${this.callbackBase}/api/ocia/clips/${job.clipAssetId}/ready`,
      }),
    });
    if (!res.ok) {
      await updateAssetStatus({ parishId: job.parishId, id: job.clipAssetId, status: "failed", error: `cut enqueue failed: ${res.status}` });
      throw new Error(`clip cut enqueue failed: ${res.status}`);
    }
  }
}

let cached: ClipProcessor | undefined;

export function getClipProcessor(): ClipProcessor {
  if (cached) return cached;
  const endpoint = process.env.CLIP_CUTTER_URL;
  const callbackBase = process.env.APP_URL;
  const stub = process.env.MEDIA_STUB === "1";
  cached = !stub && endpoint && callbackBase ? new HttpClipProcessor(endpoint, callbackBase) : new StubClipProcessor();
  return cached;
}

// ─── Orchestration (the business logic — stays in core) ──────────────────────

/** Create a clip asset for [startMs,endMs] of a source and kick off the cut. */
export async function requestClip(opts: {
  parishId: string;
  createdBy: string;
  sourceAssetId: string;
  startMs: number;
  endMs: number | null;
}): Promise<string> {
  const source = await getAsset(opts.parishId, opts.sourceAssetId);
  if (!source) throw new Error("source asset not found");
  const clipId = await createAsset({
    parishId: opts.parishId,
    createdBy: opts.createdBy,
    kind: "video",
    title: `${source.title} (clip)`,
    provider: source.provider,
    status: "processing",
    sourceAssetId: opts.sourceAssetId,
    clipStartMs: opts.startMs,
    clipEndMs: opts.endMs,
  });
  await getClipProcessor().process({ parishId: opts.parishId, clipAssetId: clipId, source, startMs: opts.startMs, endMs: opts.endMs });
  return clipId;
}

/** Remove the clip referenced by a video lesson item (if any). */
export async function removeClipForItem(parishId: string, itemId: string): Promise<void> {
  const { rows } = await getDb(parishId).query<{ clip_asset_id: string | null }>(
    "SELECT content->>'clip_asset_id' AS clip_asset_id FROM lesson_items WHERE id = $1",
    [itemId],
  );
  const clipId = rows[0]?.clip_asset_id;
  if (clipId) await removeClip(parishId, clipId);
}

/** Remove every clip referenced by a lesson's video items (across all versions). */
export async function removeClipsForLesson(parishId: string, lessonId: string): Promise<void> {
  const { rows } = await getDb(parishId).query<{ clip_asset_id: string }>(
    `SELECT li.content->>'clip_asset_id' AS clip_asset_id
       FROM lesson_items li JOIN lesson_versions v ON v.id = li.version_id
      WHERE v.lesson_id = $1 AND li.kind = 'video' AND li.content->>'clip_asset_id' IS NOT NULL`,
    [lessonId],
  );
  for (const r of rows) await removeClip(parishId, r.clip_asset_id);
}

/** Delete a clip asset (and its provider video). No-op if it isn't a clip. */
export async function removeClip(parishId: string, clipAssetId: string): Promise<void> {
  const clip = await getAsset(parishId, clipAssetId);
  if (!clip || clip.sourceAssetId == null) return; // only delete actual clips
  if (clip.providerAssetId) {
    try {
      await getStorage().delete(clip.providerAssetId);
    } catch {
      /* best-effort remote cleanup */
    }
  }
  await deleteAsset(parishId, clipAssetId);
}
