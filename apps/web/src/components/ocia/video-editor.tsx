"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Hls from "hls.js";
import { Youtube } from "lucide-react";
import { extractYouTubeId, youTubeEmbedUrl } from "@parvaordo/core/youtube-url";
import { clampTrimEnd, clampTrimStart, trimWindowToMs } from "@parvaordo/shared";
import { TrimTrack } from "@/src/components/ocia/trim-track";
import { YouTubeTrimmer } from "@/src/components/ocia/youtube-trimmer";

export interface VideoAssetOption {
  id: string;
  title: string;
  durationMs: number | null;
  playbackUrl: string;
  posterUrl: string | null;
  /** Asset provider: "youtube" renders an embed (no Bunny trim/clip); else the trimmer. */
  provider: string;
}

/**
 * Lesson video-item editor. A Bunny upload gets the iMovie-style trimmer (live
 * `<video>` preview + a filmstrip with draggable in/out handles); a YouTube source
 * gets the IFrame-API {@link YouTubeTrimmer}. Both produce the same lesson-item clip
 * window: { asset_id, start_ms, end_ms }. The shared {@link TrimTrack} renders the
 * handles + controls for both.
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
    (s: number, e: number) => {
      onChange({ ...content, asset_id: assetId, ...trimWindowToMs(s, e, duration) });
    },
    [onChange, content, assetId, duration],
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

  // Live drag from the trim track: clamp, reflect in state, scrub the preview.
  const onScrub = (which: "start" | "end", t: number) => {
    if (which === "start") {
      const s = clampTrimStart(t, endSec);
      setStartSec(s);
      seekPreview(s);
    } else {
      const e = clampTrimEnd(t, startSec, duration);
      setEndSec(e);
      seekPreview(e);
    }
  };
  const onScrubEnd = (which: "start" | "end") => {
    seekPreview(which === "start" ? startSec : endSec, true); // precise final frame
    propagate(startSec, endSec);
  };

  // Precise setters shared by the nudge buttons + numeric inputs (clamped).
  const applyStart = (v: number) => {
    const s = clampTrimStart(v, endSec);
    setStartSec(s);
    seekPreview(s, true);
    propagate(s, endSec);
  };
  const applyEnd = (v: number) => {
    const e = clampTrimEnd(v, startSec, duration);
    setEndSec(e);
    seekPreview(e, true);
    propagate(startSec, e);
  };

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

      {/* A YouTube source is trimmed via the IFrame Player API — no Bunny <video>/HLS
          scrub and no server clip cut; the student player enforces [start,end]. */}
      {asset && isYouTube && ytVideoId ? (
        <YouTubeTrimmer
          videoId={ytVideoId}
          assetId={assetId}
          content={content}
          durationHintMs={asset.durationMs}
          onChange={onChange}
        />
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

          <TrimTrack
            duration={duration}
            startSec={startSec}
            endSec={endSec}
            playhead={playhead}
            posterUrl={asset.posterUrl}
            onScrubStart={() => videoRef.current?.pause()}
            onScrub={onScrub}
            onScrubEnd={onScrubEnd}
            onApplyStart={applyStart}
            onApplyEnd={applyEnd}
          />
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
