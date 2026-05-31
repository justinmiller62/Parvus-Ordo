import { describe, expect, it } from "vitest";
import { estimateItemsDurationMin, estimateItemsDurationSec } from "./index";

describe("estimateItemsDuration", () => {
  it("sums video clip length, reading words/200wpm, and 60s per question", () => {
    const items = [
      { kind: "video", content: { start_ms: 1000, end_ms: 91000 } }, // 90s
      { kind: "reading", content: { html: "<p>" + "word ".repeat(200) + "</p>" } }, // 200 words → 60s
      { kind: "question", content: { prompt: "?" } }, // 60s
    ];
    expect(estimateItemsDurationSec(items)).toBeCloseTo(210, 5);
    expect(estimateItemsDurationMin(items)).toBe(4); // ceil(210/60)
  });

  it("ignores a video with no end set (unknown length)", () => {
    expect(estimateItemsDurationSec([{ kind: "video", content: { start_ms: 0, end_ms: null } }])).toBe(0);
  });

  it("strips HTML before counting reading words", () => {
    const sec = estimateItemsDurationSec([{ kind: "reading", content: { html: "<h2>One</h2><p>two three</p>" } }]);
    expect(sec).toBeCloseTo((3 / 200) * 60, 5);
  });
});
