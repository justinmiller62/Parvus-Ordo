"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clipResumeSeconds, clipTimeUpdate, videoWatchThresholdMs } from "@parvaordo/shared";
import { findDictionaryTerms } from "@parvaordo/core/dictionary-text";
import { saveVideoProgressAction } from "@/app/(app)/ocia/lessons/[id]/actions";
import { useDictionary } from "@/src/components/ocia/dictionary/dictionary-provider";
import type { PlayerWord } from "@/src/components/ocia/video-player";
import { loadYouTubeApi, type YTPlayer } from "@/src/lib/youtube-iframe-api";

/**
 * Seek-enforcing YouTube player — the external-source counterpart to {@link VideoPlayer}.
 * A `<video>` element can't play a YouTube watch URL, so this drives the YouTube IFrame
 * Player API instead, reusing the SAME pure gating helpers (`clipTimeUpdate`,
 * `videoWatchThresholdMs`, `clipResumeSeconds`) so the no-skip-ahead rule, watch-completion
 * threshold, progress persistence, and resume behave identically across sources. The
 * imported caption transcript (already source-agnostic) is highlighted + click-to-seek.
 *
 * Enforcement is poll-based: while playing, we sample `getCurrentTime()` (~4×/s) and apply
 * `clipTimeUpdate` — a forward scrub past `maxReached + 2s` snaps back via `seekTo`. After
 * the clip is watched (or in teacher preview) enforcement drops and navigation is free.
 */
export function YouTubePlayer({
  videoId,
  startMs,
  endMs,
  words,
  unlocked = false,
  persistItemId,
  initialMaxReachedMs = 0,
  onWatched,
}: {
  videoId: string;
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
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const startSec = startMs / 1000;
  const endSecRef = useRef<number>(endMs != null ? endMs / 1000 : Infinity);
  const maxReachedRef = useRef(clipResumeSeconds(initialMaxReachedMs));
  const watchedRef = useRef(unlocked);
  const lastSaveRef = useRef(0);
  const savedCompleteRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [watched, setWatched] = useState(unlocked);

  const persist = persistItemId && !unlocked;

  // Single source of truth for the gating decision, shared by the poll + the ended event.
  const onTick = (t: number) => {
    // Whole-video YouTube items have no explicit end — resolve it from the player as soon
    // as the duration is known (getDuration can be 0 right at onReady), so the completion
    // threshold and end-stop become finite and the watch gate can unlock.
    if (endMs == null && !Number.isFinite(endSecRef.current)) {
      const d = playerRef.current?.getDuration() ?? 0;
      if (d > 0) endSecRef.current = d;
    }
    const state = {
      currentTime: t,
      startSec,
      endSec: endSecRef.current,
      maxReached: maxReachedRef.current,
      watched: watchedRef.current,
    };
    const decision = clipTimeUpdate(state);
    if (decision.clampTo != null) {
      playerRef.current?.seekTo(decision.clampTo, true);
      return;
    }
    const rel = t - startSec;
    setCurrentTime(t);
    if (rel > maxReachedRef.current) maxReachedRef.current = rel;

    if (persist && rel - lastSaveRef.current >= 10) {
      lastSaveRef.current = rel;
      void saveVideoProgressAction(persistItemId!, Math.round(rel * 1000));
    }

    const dur = endSecRef.current - startSec;
    const watchThresholdSec = videoWatchThresholdMs(dur * 1000) / 1000;
    if (Number.isFinite(dur) && rel >= watchThresholdSec) {
      if (!watchedRef.current) {
        watchedRef.current = true;
        setWatched(true);
        onWatched?.();
      }
      if (persist && !savedCompleteRef.current) {
        void saveVideoProgressAction(persistItemId!, Math.round(rel * 1000))
          .then(() => {
            savedCompleteRef.current = true;
          })
          .catch(() => {});
      }
    }
    if (decision.atEnd) playerRef.current?.pauseVideo();
  };

  // Create the player once per video. Poll while playing; finalize on ended.
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    void loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (endMs == null) endSecRef.current = e.target.getDuration() || endSecRef.current;
            const resume = startSec + maxReachedRef.current;
            if (resume > 0.5) e.target.seekTo(resume, true);
          },
          onStateChange: (e) => {
            const S = window.YT!.PlayerState;
            if (e.data === S.PLAYING) {
              stopPoll();
              poll = setInterval(() => {
                const p = playerRef.current;
                if (p) onTick(p.getCurrentTime());
              }, 250);
            } else {
              stopPoll();
              if (e.data === S.ENDED)
                onTick(endSecRef.current === Infinity ? e.target.getDuration() : endSecRef.current);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      stopPoll();
      try {
        playerRef.current?.destroy();
      } catch {
        /* player already gone */
      }
      playerRef.current = null;
    };
    // Re-create the player only when the video changes; startMs/endMs/words are read
    // through refs/props inside the closure (no exhaustive-deps rule configured in-repo).
  }, [videoId]);

  // Persist progress on unmount + when the tab is hidden (mirrors VideoPlayer).
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

  const dict = useDictionary();
  const termWordMap = useMemo(() => {
    const map = new Map<number, string>();
    if (!dict) return map;
    const matches = findDictionaryTerms(words.map((w) => w.word).join(" "), dict.index);
    for (const m of matches) for (let k = 0; k < m.length; k++) map.set(m.at + k, m.headword);
    return map;
  }, [words, dict]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const seekToWord = (w: PlayerWord) => {
    const player = playerRef.current;
    if (!player) return;
    const rel = w.start - startSec;
    if (!watchedRef.current && rel > maxReachedRef.current + 2) return; // honor the no-skip rule
    player.seekTo(w.start, true);
    player.playVideo();
  };

  return (
    <div className="space-y-3" data-testid="youtube-player">
      <div className="overflow-hidden rounded-lg bg-black">
        {/* YT.Player replaces this node with its iframe; React owns the wrapper above. */}
        <div ref={hostRef} className="aspect-video w-full" />
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
