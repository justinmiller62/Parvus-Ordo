"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Hls from "hls.js";
import { Youtube } from "lucide-react";
import { extractYouTubeId, youTubeEmbedUrl } from "@parvaordo/core/youtube-url";

export interface VideoAssetOption {
  id: string;
  title: string;
  durationMs: number | null;
  playbackUrl: string;
  posterUrl: string | null;
  /** Asset provider: "youtube" renders an embed (no Bunny trim/clip); else the trimmer. */
  provider: string;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const NUDGE = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50";

/**
 * iMovie-style video trimmer: a live preview plus a filmstrip with draggable
 * in/out handles. Dragging a handle scrubs the preview to that frame (the iMovie
 * feel). Produces the lesson item's clip window: { asset_id, start_ms, end_ms }.
 */
export function VideoEditor({
  content,
  assets,
  onChange,
  clipStatus,
  onGenerateClip,
  generating,
  onAddYouTube,
}: {
  content: Record<string, unknown>;
  assets: VideoAssetOption[];
  onChange: (content: Record<string, unknown>) => void;
  /** Processing state of the cut clip for the current window ("none" = not cut yet). */
  clipStatus?: "none" | "processing" | "ready" | "failed";
  onGenerateClip?: () => void;
  generating?: boolean;
  /** Ingest a YouTube URL/id into the library and return it as a pickable option. */
  onAddYouTube?: (input: string, title: string) => Promise<VideoAssetOption>;
}) {
  const assetId = (content.asset_id as string | undefined) ?? "";
  const asset = assets.find((a) => a.id === assetId) ?? null;
  const isYouTube = asset?.provider === "youtube";
  const ytVideoId = isYouTube ? extractYouTubeId(asset!.playbackUrl) : null;

  // "Add from YouTube" sub-form state (a video item can source a YouTube video in
  // addition to selecting a Bunny upload — the Narthex picker's YouTube tab).
  const [ytOpen, setYtOpen] = useState(false);
  const [ytInput, setYtInput] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytBusy, setYtBusy] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const ytPreviewId = extractYouTubeId(ytInput);
  const ytPreviewUrl = ytPreviewId ? youTubeEmbedUrl(ytPreviewId) : null;

  const addYouTube = async () => {
    if (!onAddYouTube || !ytInput.trim() || ytBusy) return;
    setYtBusy(true);
    setYtError(null);
    try {
      const opt = await onAddYouTube(ytInput.trim(), ytTitle.trim());
      // YouTube items play in full — no Bunny [start,end] trim window, and no cut clip
      // (drop any stale clip_asset_id from a previously-selected Bunny source).
      const next: Record<string, unknown> = { ...content, asset_id: opt.id, start_ms: 0, end_ms: null };
      delete next.clip_asset_id;
      onChange(next);
      setYtInput("");
      setYtTitle("");
      setYtOpen(false);
    } catch (e) {
      setYtError(e instanceof Error ? e.message : "Could not add that YouTube video");
    } finally {
      setYtBusy(false);
    }
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const [duration, setDuration] = useState(asset?.durationMs ? asset.durationMs / 1000 : 0);
  const [startSec, setStartSec] = useState(((content.start_ms as number) ?? 0) / 1000);
  const [endSec, setEndSec] = useState(
    content.end_ms == null ? (asset?.durationMs ? asset.durationMs / 1000 : 0) : (content.end_ms as number) / 1000,
  );
  const [playhead, setPlayhead] = useState(0);

  // Attach HLS preview when the chosen asset changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !asset) return;
    let hls: Hls | null = null;
    if (asset.playbackUrl.endsWith(".m3u8") && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(asset.playbackUrl);
      hls.attachMedia(video);
    } else {
      video.src = asset.playbackUrl;
    }
    return () => hls?.destroy();
  }, [asset?.playbackUrl, asset]);

  // Re-seed the window when switching assets.
  useEffect(() => {
    if (!asset) return;
    const d = asset.durationMs ? asset.durationMs / 1000 : 0;
    setDuration(d);
    setStartSec(((content.start_ms as number) ?? 0) / 1000);
    setEndSec(content.end_ms == null ? d : (content.end_ms as number) / 1000);
  }, [assetId]);

  const propagate = useCallback(
    (s: number, e: number, full: boolean) => {
      onChange({
        ...content,
        asset_id: assetId,
        start_ms: Math.round(s * 1000),
        end_ms: full ? null : Math.round(e * 1000),
      });
    },
    [onChange, content, assetId],
  );

  const timeFromX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || duration === 0) return 0;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration],
  );

  // HLS can't seek on every pointer-move without thrashing the segment loader, so
  // we throttle the preview scrub (~8/s) and do one precise seek on release.
  const lastSeek = useRef(0);
  const seekPreview = (t: number, force = false) => {
    const v = videoRef.current;
    if (!v) return;
    const now = Date.now();
    if (!force && now - lastSeek.current < 120) return;
    lastSeek.current = now;
    if (v.readyState >= 1) {
      try {
        v.currentTime = Math.max(0, Math.min(t, duration || v.duration || t));
      } catch {
        /* seeking not ready yet */
      }
    }
  };

  const onPointerDownHandle = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    videoRef.current?.pause(); // don't fight playback while scrubbing
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const t = timeFromX(e.clientX);
    if (dragging.current === "start") {
      const s = Math.max(0, Math.min(t, endSec - 0.5));
      setStartSec(s);
      seekPreview(s);
    } else {
      const en = Math.min(duration, Math.max(t, startSec + 0.5));
      setEndSec(en);
      seekPreview(en);
    }
  };

  const onPointerUp = () => {
    const which = dragging.current;
    if (!which) return;
    dragging.current = null;
    seekPreview(which === "start" ? startSec : endSec, true); // precise final frame
    propagate(startSec, endSec, endSec >= duration - 0.05);
  };

  // Precise setters shared by the nudge buttons + numeric inputs (clamped).
  const applyStart = (v: number) => {
    const s = Math.max(0, Math.min(v, endSec - 0.5));
    setStartSec(s);
    seekPreview(s, true);
    propagate(s, endSec, duration > 0 && endSec >= duration - 0.05);
  };
  const applyEnd = (v: number) => {
    const hi = duration > 0 ? duration : v;
    const e = Math.max(startSec + 0.5, Math.min(v, hi));
    setEndSec(e);
    seekPreview(e, true);
    propagate(startSec, e, duration > 0 && e >= duration - 0.05);
  };

  const startPct = duration ? (startSec / duration) * 100 : 0;
  const endPct = duration ? (endSec / duration) * 100 : 100;
  const playPct = duration ? (playhead / duration) * 100 : 0;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Video</span>
        <select
          value={assetId}
          onChange={(e) => onChange({ ...content, asset_id: e.target.value, start_ms: 0, end_ms: null })}
          data-testid="video-asset-select"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select a video…</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.provider === "youtube" ? `${a.title} (YouTube)` : a.title}
            </option>
          ))}
        </select>
      </label>

      {/* Add from YouTube — sits alongside the Bunny library select (Narthex YouTube tab). */}
      {onAddYouTube ? (
        <div className="rounded-md border border-gray-200 bg-parchment/30">
          {!ytOpen ? (
            <button
              type="button"
              onClick={() => setYtOpen(true)}
              data-testid="youtube-add-toggle"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-burgundy"
            >
              <Youtube className="h-4 w-4 text-rose" />
              Add from YouTube
            </button>
          ) : (
            <div className="space-y-2 p-3 motion-safe:animate-[po-fade-in_150ms_ease-out]">
              <div className="flex items-center gap-2 text-sm font-medium text-navy">
                <Youtube className="h-4 w-4 text-rose" />
                Add a YouTube video
              </div>
              <input
                value={ytInput}
                onChange={(e) => {
                  setYtInput(e.target.value);
                  setYtError(null);
                }}
                placeholder="YouTube URL or video ID"
                data-testid="youtube-url-input"
                autoFocus
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
              <input
                value={ytTitle}
                onChange={(e) => setYtTitle(e.target.value)}
                placeholder="Title (optional)"
                data-testid="youtube-title-input"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
              {ytPreviewUrl ? (
                <div className="overflow-hidden rounded-md border border-gray-200 bg-black">
                  <iframe
                    src={ytPreviewUrl}
                    title="YouTube preview"
                    data-testid="youtube-preview"
                    className="aspect-video w-full"
                    allow="accelerometer; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : ytInput.trim() ? (
                <p className="text-xs text-gray-400">Paste a YouTube watch/share link or an 11-character video ID.</p>
              ) : null}
              {ytError ? (
                <p className="text-xs text-rose" data-testid="youtube-error" role="alert">
                  {ytError}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setYtOpen(false);
                    setYtInput("");
                    setYtTitle("");
                    setYtError(null);
                  }}
                  disabled={ytBusy}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addYouTube}
                  disabled={ytBusy || !ytInput.trim()}
                  data-testid="youtube-add-submit"
                  className="rounded-md bg-rose px-3 py-1.5 text-sm font-medium text-white hover:bg-rose/90 disabled:opacity-50"
                >
                  {ytBusy ? "Adding…" : "Add video"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {assets.length === 0 && !asset ? (
        <p className="text-sm text-gray-500" data-testid="video-empty">
          No videos in your library yet.{" "}
          <Link href="/ocia/media" className="text-burgundy underline">
            Upload one in the Media Library
          </Link>{" "}
          or add a YouTube video above.
        </p>
      ) : null}

      {/* A YouTube source plays in full via its embed — no Bunny trimmer or clip cutting. */}
      {asset && isYouTube && ytVideoId ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-black">
            <iframe
              src={youTubeEmbedUrl(ytVideoId) ?? undefined}
              title={asset.title}
              data-testid="youtube-item-preview"
              className="aspect-video w-full"
              allow="accelerometer; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="text-xs text-gray-400">
            YouTube videos play in full. Learners still can’t skip ahead until they’ve watched it through.
          </p>
        </div>
      ) : null}

      {asset && !isYouTube ? (
        <>
          <div className="overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              controls
              playsInline
              poster={asset.posterUrl ?? undefined}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) {
                  setDuration(d);
                  if (content.end_ms == null) setEndSec(d);
                }
              }}
              onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              className="aspect-video w-full"
            />
          </div>

          {/* Filmstrip trimmer */}
          <div
            ref={trackRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            data-testid="trim-track"
            className="relative h-14 touch-none select-none overflow-hidden rounded-md border border-gray-200 bg-navy/5"
            style={
              asset.posterUrl
                ? {
                    backgroundImage: `url(${asset.posterUrl})`,
                    backgroundSize: "auto 100%",
                    backgroundRepeat: "repeat-x",
                  }
                : undefined
            }
          >
            {/* dim outside the selection */}
            <div className="absolute inset-y-0 left-0 bg-black/45" style={{ width: `${startPct}%` }} />
            <div className="absolute inset-y-0 right-0 bg-black/45" style={{ width: `${100 - endPct}%` }} />
            {/* selection border */}
            <div
              className="absolute inset-y-0 border-y-2 border-gold"
              style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
            />
            {/* playhead */}
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${playPct}%` }} />
            {/* handles */}
            <div
              onPointerDown={onPointerDownHandle("start")}
              data-testid="trim-start"
              className="absolute inset-y-0 flex w-4 cursor-ew-resize items-center justify-center rounded-l bg-gold"
              style={{ left: `calc(${startPct}% - 8px)` }}
            >
              <span className="h-5 w-0.5 rounded bg-white" />
            </div>
            <div
              onPointerDown={onPointerDownHandle("end")}
              data-testid="trim-end"
              className="absolute inset-y-0 flex w-4 cursor-ew-resize items-center justify-center rounded-r bg-gold"
              style={{ left: `calc(${endPct}% - 8px)` }}
            >
              <span className="h-5 w-0.5 rounded bg-white" />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              In{" "}
              <span className="font-medium text-navy" data-testid="trim-start-label">
                {fmt(startSec)}
              </span>
            </span>
            <span>Clip length {fmt(Math.max(0, endSec - startSec))}</span>
            <span>
              Out{" "}
              <span className="font-medium text-navy" data-testid="trim-end-label">
                {fmt(endSec)}
              </span>
            </span>
          </div>

          {/* Fine-tune controls: nudge, exact entry, or snap to the current frame. */}
          <div className="space-y-2 rounded-md border border-gray-200 bg-parchment/40 p-3">
            {(
              [
                { label: "In", value: startSec, apply: applyStart, testid: "in" },
                { label: "Out", value: endSec, apply: applyEnd, testid: "out" },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex flex-wrap items-center gap-1.5">
                <span className="w-7 text-xs font-medium text-gray-500">{row.label}</span>
                <button type="button" onClick={() => row.apply(row.value - 1)} className={NUDGE}>
                  −1s
                </button>
                <button type="button" onClick={() => row.apply(row.value - 0.1)} className={NUDGE}>
                  −0.1
                </button>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={Number(row.value.toFixed(1))}
                  onChange={(e) => row.apply(Number(e.target.value))}
                  data-testid={`trim-${row.testid}-input`}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-center text-sm"
                />
                <span className="text-xs text-gray-400">s</span>
                <button type="button" onClick={() => row.apply(row.value + 0.1)} className={NUDGE}>
                  +0.1
                </button>
                <button type="button" onClick={() => row.apply(row.value + 1)} className={NUDGE}>
                  +1s
                </button>
                <button type="button" onClick={() => row.apply(playhead)} className={`${NUDGE} ml-auto`}>
                  Set to playhead
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            Drag the handles or use the controls above. Learners can’t skip ahead until they’ve watched the clip.
          </p>

          {/* Cut the physical clip (so the native player only sees this window). */}
          {onGenerateClip ? (
            <div className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2">
              <span className="flex items-center gap-2 text-sm" data-testid="clip-status">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    clipStatus === "ready"
                      ? "bg-green-500"
                      : clipStatus === "processing"
                        ? "bg-amber-400 animate-pulse"
                        : clipStatus === "failed"
                          ? "bg-rose"
                          : "bg-gray-300"
                  }`}
                />
                <span className="text-gray-600">
                  {clipStatus === "ready"
                    ? "Clip ready"
                    : clipStatus === "processing"
                      ? "Cutting clip…"
                      : clipStatus === "failed"
                        ? "Clip failed"
                        : "No clip cut yet"}
                </span>
              </span>
              <button
                type="button"
                onClick={onGenerateClip}
                disabled={generating || clipStatus === "processing"}
                data-testid="generate-clip"
                className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
              >
                {clipStatus === "ready" || clipStatus === "failed" ? "Re-cut clip" : "Generate clip"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
