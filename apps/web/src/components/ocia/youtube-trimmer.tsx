"use client";

import { useEffect, useRef, useState } from "react";
import { clampTrimEnd, clampTrimStart, trimWindowToMs } from "@parvaordo/shared";
import { loadYouTubeApi, type YTPlayer } from "@/src/lib/youtube-iframe-api";
import { TrimTrack } from "@/src/components/ocia/trim-track";

/**
 * iMovie-style trimmer for a YouTube source — the external-source counterpart to the
 * Bunny `<video>` trimmer in {@link VideoEditor}. A `<video>` element can't scrub a
 * YouTube embed, so this drives the YouTube IFrame Player API: `getDuration` sizes the
 * track and each handle drag `seekTo`s the embedded player to that frame. It writes the
 * SAME `{ asset_id, start_ms, end_ms }` window as the Bunny trimmer (shared
 * `trimWindowToMs`), which the student `YouTubePlayer` then enforces client-side — there
 * is no server clip cut for YouTube (Architecture §9: window is client-enforced).
 *
 * The window math is unit-tested in `@parvaordo/shared`; the live IFrame scrub can't be
 * exercised offline (cross-origin API) so it is verified manually, like the player.
 */
export function YouTubeTrimmer({
  videoId,
  assetId,
  content,
  durationHintMs,
  onChange,
}: {
  videoId: string;
  assetId: string;
  content: Record<string, unknown>;
  /** Probed length captured at ingest (po-l595) — sizes the track before the API loads. */
  durationHintMs: number | null;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  const hintSec = durationHintMs != null && durationHintMs > 0 ? durationHintMs / 1000 : 0;
  const [duration, setDuration] = useState(hintSec);
  const [startSec, setStartSec] = useState(((content.start_ms as number) ?? 0) / 1000);
  const [endSec, setEndSec] = useState(content.end_ms == null ? hintSec : (content.end_ms as number) / 1000);
  const [playhead, setPlayhead] = useState(0);
  const [ready, setReady] = useState(false);

  // Create the player once per video; poll currentTime/duration while it lives.
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    void loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            const d = e.target.getDuration();
            if (d > 0) {
              setDuration(d);
              // Whole-video item: pull the out-point to the now-known end.
              if (content.end_ms == null) setEndSec(d);
            }
            setReady(true);
          },
        },
      });
      poll = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          setPlayhead(p.getCurrentTime());
          const d = p.getDuration();
          if (d > 0) setDuration((prev) => (prev === d ? prev : d));
        } catch {
          /* player not ready */
        }
      }, 250);
    });
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try {
        playerRef.current?.destroy();
      } catch {
        /* player already gone */
      }
      playerRef.current = null;
    };
    // videoId is the only identity; start/end are read through state inside the closure.
  }, [videoId]);

  // The IFrame API tolerates frequent seekTo, but we still throttle the scrub (~8/s)
  // and do one precise seek on release, mirroring the Bunny trimmer's feel.
  const lastSeek = useRef(0);
  const seekPreview = (t: number, force = false) => {
    const p = playerRef.current;
    if (!p) return;
    const now = Date.now();
    if (!force && now - lastSeek.current < 120) return;
    lastSeek.current = now;
    try {
      const clamped = Math.max(0, Math.min(t, duration || t));
      p.seekTo(clamped, true);
      setPlayhead(clamped);
    } catch {
      /* seek not ready yet */
    }
  };

  const propagate = (s: number, e: number) => {
    // A YouTube item never carries a Bunny cut-clip ref; keep it out of the content.
    const next: Record<string, unknown> = { ...content, asset_id: assetId, ...trimWindowToMs(s, e, duration) };
    delete next.clip_asset_id;
    onChange(next);
  };

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
    seekPreview(which === "start" ? startSec : endSec, true);
    propagate(startSec, endSec);
  };

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
    <div className="space-y-2" data-testid="youtube-trimmer">
      <div className="overflow-hidden rounded-lg bg-black">
        {/* YT.Player replaces this node with its iframe; React owns the wrapper above. */}
        <div ref={hostRef} className="aspect-video w-full" />
      </div>
      {!ready ? (
        <p className="text-xs text-gray-400" data-testid="youtube-trimmer-loading">
          Loading the YouTube player…
        </p>
      ) : null}
      <TrimTrack
        duration={duration}
        startSec={startSec}
        endSec={endSec}
        playhead={playhead}
        onScrubStart={() => playerRef.current?.pauseVideo()}
        onScrub={onScrub}
        onScrubEnd={onScrubEnd}
        onApplyStart={applyStart}
        onApplyEnd={applyEnd}
      />
      <p className="text-xs text-gray-400">
        Drag the handles or use the controls to trim. Learners still can’t skip ahead until they’ve watched the clip.
      </p>
    </div>
  );
}
