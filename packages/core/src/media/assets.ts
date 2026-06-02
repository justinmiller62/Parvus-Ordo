// packages/core — media/asset module (Slice 5). Data access for the generic
// `assets` table (video/image/audio/pdf). Storage + transcription side effects
// live behind the StorageProvider / TranscriptionProvider abstractions; this file
// is pure persistence (RLS-scoped through getDb).

import { getDb } from "../db/client";

export type AssetScope = "global" | "diocese" | "parish";
export type AssetKind = "video" | "image" | "audio" | "pdf";
export type AssetStatus = "created" | "uploading" | "processing" | "ready" | "failed";
export type TranscriptionStatus = "none" | "pending" | "processing" | "completed" | "failed";

/** One transcript token with its timestamp window (seconds), as Whisper returns it. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Asset {
  id: string;
  scope: AssetScope;
  kind: AssetKind;
  title: string;
  provider: string;
  providerAssetId: string | null;
  playbackUrl: string | null;
  posterUrl: string | null;
  status: AssetStatus;
  durationMs: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  error: string | null;
  transcriptionStatus: TranscriptionStatus;
  transcriptText: string | null;
  transcriptJson: TranscriptWord[] | null;
  transcriptionError: string | null;
  // Set when this asset is a clip cut from another (a source video).
  sourceAssetId: string | null;
  clipStartMs: number | null;
  clipEndMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/** pg returns timestamptz as a Date and jsonb already parsed — normalize both. */
function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
}

interface AssetRow {
  id: string;
  scope: AssetScope;
  kind: AssetKind;
  title: string;
  provider: string;
  provider_asset_id: string | null;
  playback_url: string | null;
  poster_url: string | null;
  status: AssetStatus;
  duration_ms: number | null;
  size_bytes: string | number | null; // bigint comes back as string from pg
  mime_type: string | null;
  error: string | null;
  transcription_status: TranscriptionStatus;
  transcript_text: string | null;
  transcript_json: TranscriptWord[] | null;
  transcription_error: string | null;
  source_asset_id: string | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  created_at: unknown;
  updated_at: unknown;
}

function rowToAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    scope: r.scope,
    kind: r.kind,
    title: r.title,
    provider: r.provider,
    providerAssetId: r.provider_asset_id,
    playbackUrl: r.playback_url,
    posterUrl: r.poster_url,
    status: r.status,
    durationMs: r.duration_ms,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    mimeType: r.mime_type,
    error: r.error,
    transcriptionStatus: r.transcription_status,
    transcriptText: r.transcript_text,
    transcriptJson: r.transcript_json,
    transcriptionError: r.transcription_error,
    sourceAssetId: r.source_asset_id,
    clipStartMs: r.clip_start_ms,
    clipEndMs: r.clip_end_ms,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

const COLS = `id, scope, kind, title, provider, provider_asset_id, playback_url, poster_url,
  status, duration_ms, size_bytes, mime_type, error,
  transcription_status, transcript_text, transcript_json, transcription_error,
  source_asset_id, clip_start_ms, clip_end_ms,
  created_at, updated_at`;

/** Create a parish-owned asset row. Video/audio default to a pending transcript. */
export async function createAsset(opts: {
  parishId: string;
  createdBy: string;
  kind: AssetKind;
  title: string;
  provider?: string;
  providerAssetId?: string | null;
  playbackUrl?: string | null;
  posterUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  status?: AssetStatus;
  // Set these to make this asset a clip cut from `sourceAssetId`.
  sourceAssetId?: string | null;
  clipStartMs?: number | null;
  clipEndMs?: number | null;
}): Promise<string> {
  // A clip derives its transcript from the source, so it never transcribes itself.
  const isClip = opts.sourceAssetId != null;
  const wantsTranscript = !isClip && (opts.kind === "video" || opts.kind === "audio");
  const { rows } = await getDb(opts.parishId).query<{ id: string }>(
    `INSERT INTO assets
       (scope, parish_id, created_by, kind, title, provider, provider_asset_id,
        playback_url, poster_url, mime_type, size_bytes, status, transcription_status,
        source_asset_id, clip_start_ms, clip_end_ms)
     VALUES ('parish', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      opts.parishId,
      opts.createdBy,
      opts.kind,
      opts.title,
      opts.provider ?? "stub",
      opts.providerAssetId ?? null,
      opts.playbackUrl ?? null,
      opts.posterUrl ?? null,
      opts.mimeType ?? null,
      opts.sizeBytes ?? null,
      opts.status ?? "created",
      wantsTranscript ? "pending" : "none",
      opts.sourceAssetId ?? null,
      opts.clipStartMs ?? null,
      opts.clipEndMs ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function getAsset(parishId: string, id: string): Promise<Asset | null> {
  const { rows } = await getDb(parishId).query<AssetRow>(`SELECT ${COLS} FROM assets WHERE id = $1`, [id]);
  return rows[0] ? rowToAsset(rows[0]) : null;
}

/**
 * Resolve an asset's owning parish by id, pre-tenant-context, via the SECURITY DEFINER
 * `asset_parish_id` lookup (migration 0022). `assets` is RLS-scoped, so a tenant-scoped
 * read can't find an asset before we know its parish; this narrow definer lookup bypasses
 * RLS to return the true owner — mirroring validateMcpToken / resolve_parish_id.
 *
 * Lets the clip cut-service callback derive the parish from the asset itself instead of
 * trusting a client-supplied parishId (po-k92). Returns null for an unknown id or a
 * non-parish-scoped asset (global/diocese assets have a NULL parish_id; clips are always
 * parish-scoped).
 */
export async function getAssetParishId(assetId: string): Promise<string | null> {
  if (!assetId) return null;
  const { rows } = await getDb(null).query<{ parish_id: string | null }>(
    "SELECT asset_parish_id($1::uuid) AS parish_id",
    [assetId],
  );
  return rows[0]?.parish_id ?? null;
}

export async function listAssets(parishId: string, opts: { kind?: AssetKind } = {}): Promise<Asset[]> {
  // The library lists SOURCE assets only — cut clips are internal (referenced by
  // lesson items), never user-managed here.
  const where: string[] = ["source_asset_id IS NULL"];
  const params: unknown[] = [];
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const { rows } = await getDb(parishId).query<AssetRow>(
    `SELECT ${COLS} FROM assets ${clause} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(rowToAsset);
}

/** Advance the transcode/host lifecycle (e.g. processing → ready) and attach playback metadata. */
export async function updateAssetStatus(opts: {
  parishId: string;
  id: string;
  status: AssetStatus;
  providerAssetId?: string | null;
  playbackUrl?: string | null;
  posterUrl?: string | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
  error?: string | null;
}): Promise<void> {
  await getDb(opts.parishId).query(
    `UPDATE assets SET
       status = $2,
       provider_asset_id = COALESCE($3, provider_asset_id),
       playback_url      = COALESCE($4, playback_url),
       poster_url        = COALESCE($5, poster_url),
       duration_ms       = COALESCE($6, duration_ms),
       size_bytes        = COALESCE($7, size_bytes),
       error             = $8
     WHERE id = $1`,
    [
      opts.id,
      opts.status,
      opts.providerAssetId ?? null,
      opts.playbackUrl ?? null,
      opts.posterUrl ?? null,
      opts.durationMs ?? null,
      opts.sizeBytes ?? null,
      opts.error ?? null,
    ],
  );
}

export async function setTranscriptionStatus(opts: {
  parishId: string;
  id: string;
  status: TranscriptionStatus;
  error?: string | null;
}): Promise<void> {
  await getDb(opts.parishId).query(
    `UPDATE assets SET transcription_status = $2, transcription_error = $3 WHERE id = $1`,
    [opts.id, opts.status, opts.error ?? null],
  );
}

/** Store a completed transcript (text + word timings). Marks transcription completed. */
export async function setTranscript(opts: {
  parishId: string;
  id: string;
  text: string;
  words: TranscriptWord[];
  durationMs?: number | null;
}): Promise<void> {
  await getDb(opts.parishId).query(
    `UPDATE assets SET
       transcription_status = 'completed',
       transcription_error  = NULL,
       transcript_text      = $2,
       transcript_json      = $3::jsonb,
       duration_ms          = COALESCE($4, duration_ms)
     WHERE id = $1`,
    [opts.id, opts.text, JSON.stringify(opts.words), opts.durationMs ?? null],
  );
}

export async function deleteAsset(parishId: string, id: string): Promise<void> {
  await getDb(parishId).query(`DELETE FROM assets WHERE id = $1`, [id]);
}
