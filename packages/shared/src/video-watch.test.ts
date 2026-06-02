import { describe, expect, it } from "vitest";
import {
  VIDEO_PROGRESS_SAVE_INTERVAL_MS,
  VIDEO_WATCH_FIRST_SAVE_BUDGET_MS,
  VIDEO_WATCH_MAX_RATE,
  VIDEO_WATCH_MIN_FRACTION,
  VIDEO_WATCH_TOLERANCE_MS,
  pacedMaxReachedMs,
  videoWatchSatisfied,
  videoWatchThresholdMs,
} from "./index";

// The server-side completion gate (videoWatchSatisfied) is a PURE decision over the
// student's persisted furthest-reached point and the clip's real length. It is the
// authoritative check behind the player's cosmetic "watched" button — markVideoProgress
// derives `completed` from it and advanceAction bounces an unwatched video on it.
//
// It is best-effort by design: the furthest-reached point is reported by the player and
// trusted, so a client that forges maxReachedMs to the clip end can still satisfy the
// gate (residual tracked in po-4dyo). These tests pin the decision itself — what counts
// as watched for an HONEST report — not the trust boundary on the input.
describe("videoWatchThresholdMs", () => {
  it("requires reaching within the tolerance of the end for a clip longer than the tolerance", () => {
    expect(videoWatchThresholdMs(60_000)).toBe(60_000 - VIDEO_WATCH_TOLERANCE_MS);
    expect(videoWatchThresholdMs(8_000)).toBe(8_000 - VIDEO_WATCH_TOLERANCE_MS);
  });

  it("falls back to a high-fraction floor for a clip at or under the tolerance (so it isn't ungated)", () => {
    // duration - tolerance <= 0 here, which would wave through zero progress; the
    // fraction floor keeps a short clip requiring real watching.
    expect(videoWatchThresholdMs(3_000)).toBe(3_000 * VIDEO_WATCH_MIN_FRACTION);
    expect(videoWatchThresholdMs(5_000)).toBe(5_000 * VIDEO_WATCH_MIN_FRACTION);
  });

  it("is unsatisfiable for an unknown / non-positive / non-finite length", () => {
    expect(videoWatchThresholdMs(0)).toBe(Infinity);
    expect(videoWatchThresholdMs(-1)).toBe(Infinity);
    expect(videoWatchThresholdMs(Infinity)).toBe(Infinity);
  });
});

describe("videoWatchSatisfied", () => {
  it("fails closed when the clip length is unknown or non-positive", () => {
    expect(videoWatchSatisfied(10_000, null)).toBe(false);
    expect(videoWatchSatisfied(10_000, 0)).toBe(false);
    expect(videoWatchSatisfied(10_000, -5)).toBe(false);
  });

  it("rejects no progress and partial progress on a normal clip", () => {
    expect(videoWatchSatisfied(0, 60_000)).toBe(false);
    expect(videoWatchSatisfied(10_000, 60_000)).toBe(false);
    expect(videoWatchSatisfied(54_999, 60_000)).toBe(false);
  });

  it("accepts a furthest point within tolerance of the end, and at/over the end", () => {
    expect(videoWatchSatisfied(55_000, 60_000)).toBe(true); // exactly the threshold
    expect(videoWatchSatisfied(60_000, 60_000)).toBe(true); // reached the end
    expect(videoWatchSatisfied(8_000, 8_000)).toBe(true);
    expect(videoWatchSatisfied(3_000, 8_000)).toBe(true); // 8s clip threshold is 3s
  });

  it("does NOT ungate a short (sub-tolerance) clip at zero progress — the floor fix", () => {
    // Before the floor: 3000 - 5000 <= 0 meant maxReached=0 satisfied the gate, so a
    // clip of five seconds or less completed with no watching at all.
    expect(videoWatchSatisfied(0, 3_000)).toBe(false);
    expect(videoWatchSatisfied(100, 3_000)).toBe(false);
    expect(videoWatchSatisfied(2_699, 3_000)).toBe(false);
    // A genuinely-watched short clip still passes (>= 90% of a 3s clip).
    expect(videoWatchSatisfied(2_700, 3_000)).toBe(true);
    expect(videoWatchSatisfied(3_000, 3_000)).toBe(true);
  });

  it("rejects a non-finite or negative report", () => {
    expect(videoWatchSatisfied(Number.NaN, 60_000)).toBe(false);
    expect(videoWatchSatisfied(Number.POSITIVE_INFINITY, 60_000)).toBe(false);
    expect(videoWatchSatisfied(-100, 60_000)).toBe(false);
  });
});

// `pacedMaxReachedMs` is what closes po-4dyo's residual: the furthest-reached point is
// still client-reported, but the server now bounds how far it can advance in one save to
// the REAL wall-clock elapsed since the previous save (times the max believable playback
// rate). So a single forged save can no longer jump a clip to its end — reaching the end
// takes roughly a clip-length of real elapsed time. Pure + deterministic (wall-clock is
// passed in), so it pins the trust boundary without a real clock.
describe("pacedMaxReachedMs", () => {
  it("allows the first save (no prior timestamp) up to the fixed budget, and caps a forge to it", () => {
    // wallElapsedMs === null means "first save for this item" — there is no previous
    // timestamp to pace against, so the one fixed budget applies.
    expect(pacedMaxReachedMs(0, 5_000, null)).toBe(5_000); // honest opening save passes
    expect(pacedMaxReachedMs(0, VIDEO_WATCH_FIRST_SAVE_BUDGET_MS, null)).toBe(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS);
    // A forge to a far-future point on the very first save is capped to the budget.
    expect(pacedMaxReachedMs(0, 5_000_000, null)).toBe(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS);
  });

  it("the first-save budget covers a real opening throttle save", () => {
    // The player batches ~one save interval of new ground before its first save, so that
    // opening save must always land — otherwise a legitimate watcher is throttled.
    expect(pacedMaxReachedMs(0, VIDEO_PROGRESS_SAVE_INTERVAL_MS, null)).toBe(VIDEO_PROGRESS_SAVE_INTERVAL_MS);
    expect(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS).toBeGreaterThan(VIDEO_PROGRESS_SAVE_INTERVAL_MS);
  });

  it("paces a subsequent save against wall-clock × the max rate", () => {
    // 10s of real time at 1× lets the point advance ~10s; a normal watcher passes.
    expect(pacedMaxReachedMs(12_000, 22_000, 10_000)).toBe(22_000);
    // A 2× watcher: 10s of new ground in 5s of real time still passes (rate ceiling 2.5).
    expect(pacedMaxReachedMs(10_000, 20_000, 5_000)).toBe(20_000);
    // The exact ceiling is prev + wall × rate.
    expect(pacedMaxReachedMs(10_000, 999_999, 10_000)).toBe(10_000 + 10_000 * VIDEO_WATCH_MAX_RATE);
  });

  it("a forge with little/no elapsed time is capped to (essentially) the prior point — no rapid walk-up", () => {
    // The walk-up exploit: spam saves to climb to the clip end. With a measured elapsed of
    // zero the budget is zero, so a rapid save can't grow the point at all (the first-save
    // budget applies ONLY when there is no prior row, not to a fast second save).
    expect(pacedMaxReachedMs(12_000, 5_000_000, 0)).toBe(12_000);
    // A few ms of real time only buys a few ms × rate of advance, not the clip end.
    expect(pacedMaxReachedMs(12_000, 5_000_000, 4)).toBe(12_000 + 4 * VIDEO_WATCH_MAX_RATE);
  });

  it("never moves the point backwards (monotonic) and ignores garbage input", () => {
    expect(pacedMaxReachedMs(20_000, 5_000, 10_000)).toBe(20_000); // report below stored → held
    expect(pacedMaxReachedMs(20_000, 20_000, 10_000)).toBe(20_000); // equal → held
    expect(pacedMaxReachedMs(0, Number.NaN, null)).toBe(0);
    expect(pacedMaxReachedMs(0, -100, null)).toBe(0);
    // A non-finite or negative measured elapsed (clock skew) grants no advance — fail closed.
    expect(pacedMaxReachedMs(5_000, 99_999, Number.NaN)).toBe(5_000);
    expect(pacedMaxReachedMs(5_000, 99_999, -1_000)).toBe(5_000);
  });

  it("a single first-save forge cannot self-complete a clip longer than the budget", () => {
    // The headline property (po-4dyo): forge the furthest point to a long clip's end in one
    // save → it's paced down to the first-save budget, which is below the completion
    // threshold, so the derived completion stays false.
    const longClip = 300_000;
    const forged = pacedMaxReachedMs(0, longClip, null);
    expect(forged).toBe(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS);
    expect(videoWatchSatisfied(forged, longClip)).toBe(false);
  });
});
