import { describe, expect, it } from "vitest";
import {
  TRIM_MIN_GAP_SEC,
  clampTrimEnd,
  clampTrimStart,
  formatTimecode,
  isFullTrimWindow,
  trimWindowToMs,
} from "./index";

// The trim-window math behind both the Bunny (<video>) and YouTube (IFrame API)
// trimmers. Pure so the offline-untestable IFrame trimmer still has real coverage
// of its window logic. Mirrors the legacy inline Bunny math: 0.5s minimum gap, a
// 0.05s "reaches the end" epsilon → store end_ms as null (full video).

describe("clampTrimStart", () => {
  it("passes a value already inside the window through", () => {
    expect(clampTrimStart(30, 120)).toBe(30);
  });

  it("floors a negative in-point to 0", () => {
    expect(clampTrimStart(-5, 120)).toBe(0);
  });

  it("keeps at least the minimum gap below the out-point", () => {
    expect(clampTrimStart(119.9, 120)).toBe(120 - TRIM_MIN_GAP_SEC);
  });
});

describe("clampTrimEnd", () => {
  it("passes a value already inside the window through", () => {
    expect(clampTrimEnd(90, 30, 120)).toBe(90);
  });

  it("caps the out-point at the duration", () => {
    expect(clampTrimEnd(999, 30, 120)).toBe(120);
  });

  it("keeps at least the minimum gap above the in-point", () => {
    expect(clampTrimEnd(30.1, 30, 120)).toBe(30 + TRIM_MIN_GAP_SEC);
  });

  it("falls back to the requested value when the duration is unknown (0)", () => {
    // Before the media reports its length, clamp can only respect the in-point gap.
    expect(clampTrimEnd(45, 10, 0)).toBe(45);
  });
});

describe("isFullTrimWindow", () => {
  it("is true when the out-point reaches the end within the epsilon", () => {
    expect(isFullTrimWindow(119.97, 120)).toBe(true);
    expect(isFullTrimWindow(120, 120)).toBe(true);
  });

  it("is false for a genuine sub-window", () => {
    expect(isFullTrimWindow(90, 120)).toBe(false);
  });

  it("is false when the duration is unknown (0) — never collapse to full blindly", () => {
    expect(isFullTrimWindow(0, 0)).toBe(false);
  });
});

describe("trimWindowToMs", () => {
  it("stores end_ms as null for a full-video window", () => {
    expect(trimWindowToMs(0, 120, 120)).toEqual({ start_ms: 0, end_ms: null });
  });

  it("stores an explicit end_ms for a sub-window, rounding to whole ms", () => {
    expect(trimWindowToMs(12.3415, 90.1239, 120)).toEqual({ start_ms: 12342, end_ms: 90124 });
  });

  it("keeps a non-zero start even when the window runs to the end", () => {
    expect(trimWindowToMs(30, 120, 120)).toEqual({ start_ms: 30000, end_ms: null });
  });
});

describe("formatTimecode", () => {
  it("formats m:ss with a zero-padded seconds field", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(65)).toBe("1:05");
    expect(formatTimecode(600)).toBe("10:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTimecode(5.9)).toBe("0:05");
  });

  it("clamps negative / non-finite input to 0:00", () => {
    expect(formatTimecode(-3)).toBe("0:00");
    expect(formatTimecode(Number.NaN)).toBe("0:00");
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
