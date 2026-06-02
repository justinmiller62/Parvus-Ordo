import { describe, expect, it } from "vitest";
import {
  VIDEO_WATCH_MIN_FRACTION,
  VIDEO_WATCH_TOLERANCE_MS,
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
