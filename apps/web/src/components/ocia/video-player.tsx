"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { clipSeek, clipTimeUpdate } from "@parvaordo/shared";
import { saveVideoProgressAction } from "@/app/(app)/ocia/lessons/[id]/actions";

export interface PlayerWord {
  word: string;
  start: number; // absolute seconds
  end: number;
}

/**
 * Seek-enforcing clip player (ported from Narthex SegmentPlayer). Plays the HLS
 * stream `src` restricted to [startMs, endMs); the learner can't skip past the
 * furthest point they've watched (+2s grace) until the clip is finished. The
 * no-skip SEEK enforcement is client-side per Architecture §9 (we don't cut
 * server-side clip assets); video COMPLETION, however, is gated on the server from
 * the persisted progress this player reports (see markVideoProgress /
 * isVideoItemWatched), so reporting progress is the only way to be marked done.
 *
 * `words` is the transcript ALREADY clipped to this window (server-side); we just
 * sync-highlight and allow click-to-seek (still subject to the no-skip rule).
 */
export function VideoPlayer({
  src,
  startMs,
  endMs,
  words,
  unlocked = false,
  persistItemId,
  initialMaxReachedMs = 0,
  onWatched,
}: {
  src: string;
  startMs: number;
  endMs: number | null;
  words: PlayerWord[];
  /** Teacher preview: drop the no-skip enforcement entirely. */
  unlocked?: boolean;
  /** When set (student view), persist progress/completion for this lesson item. */
  persistItemId?: string;
  initialMaxReachedMs?: number;
  onWatched?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const startSec = startMs / 1000;
  const endSecRef = useRef<number>(endMs != null ? endMs / 1000 : Infinity);
  const maxReachedRef = useRef(initialMaxReachedMs / 1000); // furthest relative seconds reached (resume seed)
  const watchedRef = useRef(unlocked);
  const lastSaveRef = useRef(0);
  const savedCompleteRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [watched, setWatched] = useState(unlocked);

  const persist = persistItemId && !unlocked;

  // Attach HLS (or native for Safari / non-m3u8). Uses the hls.js-recommended
  // attach-then-load order + fatal-error recovery — without the recovery, the first
  // client-side mount can hit a fatal MEDIA_ERROR and the player stays dead until a
  // full page reload (the "only works after refresh" bug).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const isHls = src.endsWith(".m3u8");

    // Native HLS (Safari/iOS) — no hls.js needed.
    if (isHls && !Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (!isHls || !Hls.isSupported()) {
      video.src = src;
      return;
    }

    const hls = new Hls({ backBufferLength: 30 });
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else hls.destroy();
    });
    return () => hls.destroy();
  }, [src]);

  // Resume position + resolve clip end once metadata is known.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      if (endMs == null) endSecRef.current = video.duration;
      video.currentTime = startSec + maxReachedRef.current;
    };
    video.addEventListener("loadedmetadata", onLoaded);
    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [src, startSec, endMs]);

  // Time tracking + seek enforcement.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const state = () => ({
      currentTime: video.currentTime,
      startSec,
      endSec: endSecRef.current,
      maxReached: maxReachedRef.current,
      watched: watchedRef.current,
    });
    // On manual seeks, keep the user inside the window (incl. before the start).
    const enforce = () => {
      const d = clipSeek(state());
      if (d.clampTo != null) video.currentTime = d.clampTo;
    };
    const onTime = () => {
      const t = video.currentTime;
      // No-skip-ahead clamp + end-stop come from the pure helper (which deliberately
      // does NOT clamp to start every tick — that stalls a non-zero-start window).
      const decision = clipTimeUpdate(state());
      if (decision.clampTo != null) {
        video.currentTime = decision.clampTo;
        return;
      }
      const rel = t - startSec;
      setCurrentTime(t);
      if (rel > maxReachedRef.current) maxReachedRef.current = rel;

      // Persist progress, throttled to ~10s of new ground.
      if (persist && rel - lastSaveRef.current >= 10) {
        lastSaveRef.current = rel;
        void saveVideoProgressAction(persistItemId!, Math.round(rel * 1000));
      }

      const dur = endSecRef.current - startSec;
      if (Number.isFinite(dur) && rel >= dur - 5) {
        if (!watchedRef.current) {
          watchedRef.current = true;
          setWatched(true);
          onWatched?.();
        }
        // In the last 5s, push progress every tick until one save lands (≈5 attempts);
        // the server derives completion once a reported point reaches the clip end.
        if (persist && !savedCompleteRef.current) {
          void saveVideoProgressAction(persistItemId!, Math.round(rel * 1000))
            .then(() => {
              savedCompleteRef.current = true;
            })
            .catch(() => {});
        }
      }
      if (decision.atEnd) {
        video.pause();
        video.currentTime = Math.max(startSec, endSecRef.current - 0.1);
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeking", enforce);
    video.addEventListener("seeked", enforce);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeking", enforce);
      video.removeEventListener("seeked", enforce);
    };
  }, [startSec]);

  // Persist progress on unmount and when the tab is hidden (catches navigation away).
  useEffect(() => {
    if (!persist) return;
    const save = () => void saveVideoProgressAction(persistItemId!, Math.round(maxReachedRef.current * 1000));
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      save();
    };
  }, [persist, persistItemId]);

  const activeIndex = words.findIndex((w) => currentTime >= w.start && currentTime < w.end);

  // Auto-scroll the active word into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const seekToWord = (w: PlayerWord) => {
    const video = videoRef.current;
    if (!video) return;
    const rel = w.start - startSec;
    // Honor the no-skip rule: can't jump beyond what's been watched.
    if (!watchedRef.current && rel > maxReachedRef.current + 2) return;
    video.currentTime = w.start;
    void video.play();
  };

  return (
    <div className="space-y-3" data-testid="video-player">
      <div className="overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} controls playsInline className="aspect-video w-full" />
      </div>
      {!watched ? (
        <p className="text-xs text-gray-400" data-testid="seek-locked">
          Watch the full clip to unlock free navigation.
        </p>
      ) : null}
      {words.length > 0 ? (
        <div
          className="max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed"
          data-testid="transcript"
        >
          {words.map((w, i) => (
            <button
              key={i}
              ref={i === activeIndex ? activeRef : undefined}
              onClick={() => seekToWord(w)}
              className={`rounded px-0.5 ${i === activeIndex ? "bg-gold/30 text-navy" : "text-gray-600 hover:bg-parchment"}`}
            >
              {w.word}{" "}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
