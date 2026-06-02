import { describe, expect, it } from "vitest";
import { clipResumeSeconds, clipSeek, clipTimeUpdate } from "./index";

// Window 1:40 → 6:00 (a non-zero start, like the bug repro).
const base = { startSec: 100, endSec: 360, maxReached: 0, watched: false };

describe("clipTimeUpdate (per-tick)", () => {
  it("does NOT clamp to the window start while buffering toward a non-zero start (regression)", () => {
    // The old bug: every tick below startSec yanked currentTime back to startSec,
    // creating a seek loop that stalled playback. This must stay a no-op.
    expect(clipTimeUpdate({ ...base, currentTime: 0.5 })).toEqual({});
    expect(clipTimeUpdate({ ...base, currentTime: 50 })).toEqual({});
  });

  it("clamps no-skip-ahead beyond maxReached + 2s when unwatched", () => {
    expect(clipTimeUpdate({ ...base, currentTime: 115, maxReached: 10 })).toEqual({ clampTo: 110 });
  });

  it("allows movement within the maxReached + 2s grace", () => {
    expect(clipTimeUpdate({ ...base, currentTime: 111, maxReached: 10 })).toEqual({});
  });

  it("does not enforce no-skip once watched", () => {
    expect(clipTimeUpdate({ ...base, currentTime: 300, maxReached: 10, watched: true })).toEqual({});
  });

  it("flags atEnd at/after the window end", () => {
    expect(clipTimeUpdate({ ...base, currentTime: 360, watched: true })).toEqual({ atEnd: true });
  });

  it("never flags atEnd for an open-ended window", () => {
    expect(clipTimeUpdate({ ...base, endSec: Infinity, currentTime: 99999, watched: true })).toEqual({});
  });
});

describe("clipSeek (manual seek)", () => {
  it("clamps a seek before the window start up to the start", () => {
    expect(clipSeek({ ...base, currentTime: 5 })).toEqual({ clampTo: 100 });
  });

  it("clamps a forward seek beyond maxReached + 2s when unwatched", () => {
    expect(clipSeek({ ...base, currentTime: 200, maxReached: 10 })).toEqual({ clampTo: 110 });
  });

  it("allows free seeking once watched", () => {
    expect(clipSeek({ ...base, currentTime: 300, watched: true })).toEqual({});
  });
});

// po-a7c: persisted watch progress (max_reached_ms) must seed the player's
// seek-enforcement ceiling on (re)load — not only the resume position. The player
// converts the stored ms to clip-relative seconds and uses that ONE value for both
// resume AND `ClipState.maxReached`; clipResumeSeconds is that conversion. Seeding the
// ceiling at 0 (fetching the value but spending it on resume only) silently brings
// back the legacy "enforcement resets on reload" bug, so it is guarded here.
describe("clipResumeSeconds (seek-enforcement seed restored from persisted progress)", () => {
  it("converts persisted ms to clip-relative seconds", () => {
    expect(clipResumeSeconds(10_000)).toBe(10);
  });

  it("floors absent / negative / non-finite progress to 0 (no ground covered)", () => {
    expect(clipResumeSeconds(0)).toBe(0);
    expect(clipResumeSeconds(-5_000)).toBe(0);
    expect(clipResumeSeconds(Number.NaN)).toBe(0);
  });

  it("seeds maxReached so a reloaded (unwatched) learner keeps their earned ground", () => {
    // Fresh load → `watched` starts false; only the restored ceiling gates seeks.
    const maxReached = clipResumeSeconds(10_000); // 10s previously watched, persisted
    const reloaded = { startSec: 0, endSec: 360, maxReached, watched: false };
    // Returning within already-watched ground is allowed; skipping past it is clamped.
    expect(clipSeek({ ...reloaded, currentTime: 8 })).toEqual({});
    expect(clipSeek({ ...reloaded, currentTime: 300 })).toEqual({ clampTo: 10 });
    expect(clipTimeUpdate({ ...reloaded, currentTime: 300 })).toEqual({ clampTo: 10 });
  });

  it("WITHOUT the seed (ceiling 0) a reloaded learner is re-locked to the start — the legacy bug", () => {
    const unseeded = { startSec: 0, endSec: 360, maxReached: 0, watched: false };
    expect(clipSeek({ ...unseeded, currentTime: 8 })).toEqual({ clampTo: 0 });
  });
});
