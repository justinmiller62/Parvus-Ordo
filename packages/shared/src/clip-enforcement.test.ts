import { describe, expect, it } from "vitest";
import { clipSeek, clipTimeUpdate } from "./index";

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
