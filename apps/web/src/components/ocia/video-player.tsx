"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  VIDEO_PROGRESS_SAVE_INTERVAL_MS,
  clipResumeSeconds,
  clipSeek,
  clipTimeUpdate,
  videoWatchThresholdMs,
} from "@parvaordo/shared";
import { findDictionaryTerms } from "@parvaordo/core/dictionary-text";
import { saveVideoProgressAction } from "@/app/(app)/ocia/lessons/[id]/actions";
import { useDictionary } from "@/src/components/ocia/dictionary/dictionary-provider";

export interface PlayerWord {
  word: string;
  start: number; // absolute seconds
  end: number;
}

/**
 * Seek-enforcing clip player (ported from Narthex SegmentPlayer). Plays the HLS
 * stream `src` restricted to [startMs, endMs); the learner can't skip past the
 * furthest point they've watched (+2s grace) until the clip is finished. Enforcement
 * is client-side per Architecture §9 — we don't cut server-side clip assets.
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
  // Furthest relative seconds reached, restored from persisted progress. Seeds BOTH
  // the resume position and the seek-enforcement ceiling (see state() below), so the
  // no-skip rule survives a reload rather than resetting to the clip start (po-a7c).
  const maxReachedRef = useRef(clipResumeSeconds(initialMaxReachedMs));
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

      // Persist progress, throttled to one save interval of new ground. The server paces
      // each save against real elapsed time, so this cadence sets the natural watch pace.
      if (persist && rel - lastSaveRef.current >= VIDEO_PROGRESS_SAVE_INTERVAL_MS / 1000) {
        lastSaveRef.current = rel;
        void saveVideoProgressAction(persistItemId!, Math.round(rel * 1000));
      }

      const dur = endSecRef.current - startSec;
      // Same threshold the server completion gate uses (videoWatchThresholdMs), so the
      // cosmetic unlock and the persisted "watched" point agree — a short clip unlocks at
      // its floor, not at zero, instead of the old flat 5s end-grace.
      const watchThresholdSec = videoWatchThresholdMs(dur * 1000) / 1000;
      if (Number.isFinite(dur) && rel >= watchThresholdSec) {
        if (!watchedRef.current) {
          watchedRef.current = true;
          setWatched(true);
          onWatched?.();
        }
        // Persist the furthest point once within the threshold so the server gate is
        // satisfied; retry on each tick until one save lands (savedCompleteRef flips only
        // on success), covering a dropped request near the end.
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

  // Dictionary highlighting of transcript words (no-op when no DictionaryProvider is
  // mounted, e.g. outside the lesson view). Each word index covered by a matched term
  // maps to its headword, so clicking it opens the definition instead of seeking.
  const dict = useDictionary();
  const termWordMap = useMemo(() => {
    const map = new Map<number, string>();
    if (!dict) return map;
    const matches = findDictionaryTerms(words.map((w) => w.word).join(" "), dict.index);
    for (const m of matches) for (let k = 0; k < m.length; k++) map.set(m.at + k, m.headword);
    return map;
  }, [words, dict]);

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
          {words.map((w, i) => {
            const headword = termWordMap.get(i);
            if (headword) {
              return (
                <button
                  key={i}
                  ref={i === activeIndex ? activeRef : undefined}
                  onClick={() => dict?.open(headword)}
                  data-testid="transcript-term"
                  title="View definition"
                  className={`rounded px-0.5 font-medium text-burgundy underline decoration-dotted decoration-gold underline-offset-2 hover:bg-cream/50 ${
                    i === activeIndex ? "bg-gold/30" : ""
                  }`}
                >
                  {w.word}{" "}
                </button>
              );
            }
            return (
              <button
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                onClick={() => seekToWord(w)}
                className={`rounded px-0.5 ${i === activeIndex ? "bg-gold/30 text-navy" : "text-gray-600 hover:bg-parchment"}`}
              >
                {w.word}{" "}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
