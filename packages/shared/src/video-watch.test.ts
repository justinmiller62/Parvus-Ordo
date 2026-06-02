import { describe, expect, it } from "vitest";
import { videoWatchSatisfied, VIDEO_WATCH_TOLERANCE_MS } from "./index";

// The pure decision behind the server-side video gate (apps call it via core's
// isVideoItemWatched / markVideoProgress). The player's `watched` button is only
// cosmetic — these cases pin down that the SERVER refuses an unwatched completion.
describe("videoWatchSatisfied (server-side video-watch gate)", () => {
  const DUR = 60_000; // a 60s clip

  it("rejects an unwatched video (zero persisted progress) — the tampered-completion case", () => {
    expect(videoWatchSatisfied(0, DUR)).toBe(false);
  });

  it("rejects a partial watch that stops short of the tolerance window", () => {
    expect(videoWatchSatisfied(30_000, DUR)).toBe(false); // halfway
    expect(videoWatchSatisfied(DUR - VIDEO_WATCH_TOLERANCE_MS - 1, DUR)).toBe(false); // 1ms short
  });

  it("accepts a watch that reaches within tolerance of the clip end", () => {
    expect(videoWatchSatisfied(DUR - VIDEO_WATCH_TOLERANCE_MS, DUR)).toBe(true); // exact boundary
    expect(videoWatchSatisfied(DUR, DUR)).toBe(true); // watched to the end
    expect(videoWatchSatisfied(DUR + 250, DUR)).toBe(true); // slight overshoot is fine
  });

  it("fails closed when the clip length is unknown or non-positive", () => {
    expect(videoWatchSatisfied(999_999, null)).toBe(false); // duration could not be resolved
    expect(videoWatchSatisfied(10, 0)).toBe(false); // malformed zero-length window
  });

  it("treats a clip shorter than the tolerance as effectively ungated (mirrors the client)", () => {
    // The player flips `watched` at dur-5s; for a <5s clip that is immediate, so the
    // server matches rather than blocking a clip that cannot meaningfully be skipped.
    expect(videoWatchSatisfied(0, 3_000)).toBe(true);
  });
});
