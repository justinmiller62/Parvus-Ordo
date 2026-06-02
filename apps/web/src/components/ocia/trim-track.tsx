"use client";

import { useCallback, useRef } from "react";
import { formatTimecode } from "@parvaordo/shared";

const NUDGE = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50";

/**
 * Presentational iMovie-style trim track: a filmstrip with two draggable in/out
 * handles, an In / clip-length / Out readout, and fine-tune controls (nudge, exact
 * entry, snap-to-playhead). Source-agnostic — the parent owns the media element and
 * the window state and wires the seek/commit callbacks, so the SAME track drives both
 * the Bunny `<video>` trimmer and the YouTube IFrame trimmer. All clamping lives in
 * the parent's handlers; the track only converts a pointer position to a raw time.
 */
export function TrimTrack({
  duration,
  startSec,
  endSec,
  playhead,
  posterUrl,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onApplyStart,
  onApplyEnd,
}: {
  duration: number;
  startSec: number;
  endSec: number;
  playhead: number;
  /** Filmstrip backdrop (Bunny poster); YouTube has none → a plain track. */
  posterUrl?: string | null;
  onScrubStart: (which: "start" | "end") => void;
  onScrub: (which: "start" | "end", t: number) => void;
  onScrubEnd: (which: "start" | "end") => void;
  onApplyStart: (sec: number) => void;
  onApplyEnd: (sec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const timeFromX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || duration === 0) return 0;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration],
  );

  const onPointerDownHandle = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    onScrubStart(which);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onScrub(dragging.current, timeFromX(e.clientX));
  };

  const onPointerUp = () => {
    const which = dragging.current;
    if (!which) return;
    dragging.current = null;
    onScrubEnd(which);
  };

  const startPct = duration ? (startSec / duration) * 100 : 0;
  const endPct = duration ? (endSec / duration) * 100 : 100;
  const playPct = duration ? (playhead / duration) * 100 : 0;

  return (
    <>
      {/* Filmstrip trimmer */}
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        data-testid="trim-track"
        className="relative h-14 touch-none select-none overflow-hidden rounded-md border border-gray-200 bg-navy/5"
        style={
          posterUrl
            ? {
                backgroundImage: `url(${posterUrl})`,
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
            {formatTimecode(startSec)}
          </span>
        </span>
        <span>Clip length {formatTimecode(Math.max(0, endSec - startSec))}</span>
        <span>
          Out{" "}
          <span className="font-medium text-navy" data-testid="trim-end-label">
            {formatTimecode(endSec)}
          </span>
        </span>
      </div>

      {/* Fine-tune controls: nudge, exact entry, or snap to the current frame. */}
      <div className="space-y-2 rounded-md border border-gray-200 bg-parchment/40 p-3">
        {(
          [
            { label: "In", value: startSec, apply: onApplyStart, testid: "in" },
            { label: "Out", value: endSec, apply: onApplyEnd, testid: "out" },
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
    </>
  );
}
