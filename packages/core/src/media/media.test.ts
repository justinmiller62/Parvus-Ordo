import { describe, expect, it } from "vitest";
import { mapBunnyStatus } from "./storage";
import { clipTranscript, formatTranscript } from "./transcription";

describe("mapBunnyStatus", () => {
  it("maps finished → ready with full progress + duration", () => {
    expect(mapBunnyStatus(4, 100, 90)).toEqual({ status: "ready", progress: 100, durationMs: 90_000 });
  });
  it("maps in-flight codes → processing with encode progress", () => {
    expect(mapBunnyStatus(3, 42, null)).toEqual({ status: "processing", progress: 42, durationMs: null });
  });
  it("maps just-uploaded → uploading", () => {
    expect(mapBunnyStatus(1, 0, null).status).toBe("uploading");
  });
  it("maps error/upload-failed → failed", () => {
    expect(mapBunnyStatus(5, 0, null).status).toBe("failed");
    expect(mapBunnyStatus(6, 0, null).status).toBe("failed");
  });
});

describe("clipTranscript", () => {
  const words = [
    { word: "a", start: 0, end: 1 },
    { word: "b", start: 1, end: 2 },
    { word: "c", start: 2, end: 3 },
    { word: "d", start: 3, end: 4 },
  ];
  it("keeps only words overlapping the clip window", () => {
    expect(clipTranscript(words, 1000, 3000).map((w) => w.word)).toEqual(["b", "c"]);
  });
  it("treats null end as open-ended", () => {
    expect(clipTranscript(words, 2000, null).map((w) => w.word)).toEqual(["c", "d"]);
  });
});

describe("formatTranscript", () => {
  it("falls back to verbatim text when there are no word timings", () => {
    expect(formatTranscript("hello world", null)).toBe("hello world");
    expect(formatTranscript("hi", [])).toBe("hi");
  });
  it("groups word-timed transcripts into [m:ss] ~10s blocks", () => {
    const words = [
      { word: "a", start: 0, end: 1 },
      { word: "b", start: 5, end: 6 },
      { word: "c", start: 12, end: 13 }, // ≥10s after block start → new block
      { word: "d", start: 65, end: 66 },
    ];
    expect(formatTranscript(null, words)).toBe("[0:00] a b\n[0:12] c\n[1:05] d");
  });
});
