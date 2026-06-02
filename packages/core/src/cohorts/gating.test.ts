import { describe, expect, it } from "vitest";
import {
  computeDueDate,
  computeReleaseDate,
  isLessonHidden,
  isLessonLocked,
  isReleased,
  lessonProgressStatus,
  type ScheduleGatingEntry,
} from "./gating";

const entry = (
  over: Partial<ScheduleGatingEntry> & { lessonId: string; discussionDate: string },
): ScheduleGatingEntry => ({
  releaseDate: null,
  dueDate: null,
  skipSequence: false,
  ...over,
});

describe("computeReleaseDate — single source of truth", () => {
  const entries: ScheduleGatingEntry[] = [
    entry({ lessonId: "a", discussionDate: "2026-06-02" }),
    entry({ lessonId: "b", discussionDate: "2026-06-09" }),
    entry({ lessonId: "c", discussionDate: "2026-06-16", releaseDate: "2026-06-10" }),
  ];

  it("an explicit release_date always wins", () => {
    expect(computeReleaseDate(entries, 2, "2026-06-01")).toBe("2026-06-10");
  });

  it("first entry falls back to the cohort start_date", () => {
    expect(computeReleaseDate(entries, 0, "2026-06-01")).toBe("2026-06-01");
  });

  it("first entry with no start_date is always-released (null)", () => {
    expect(computeReleaseDate(entries, 0, null)).toBeNull();
  });

  it("a later entry falls back to the day after the previous discussion date", () => {
    expect(computeReleaseDate(entries, 1, "2026-06-01")).toBe("2026-06-03"); // 06-02 + 1
  });
});

describe("computeDueDate", () => {
  it("uses an explicit due_date when present", () => {
    expect(computeDueDate(entry({ lessonId: "a", discussionDate: "2026-06-09", dueDate: "2026-06-07" }))).toBe(
      "2026-06-07",
    );
  });
  it("falls back to discussion_date − 1 day", () => {
    expect(computeDueDate(entry({ lessonId: "a", discussionDate: "2026-06-09" }))).toBe("2026-06-08");
  });
});

describe("isReleased / isLessonHidden", () => {
  it("null release is always released", () => {
    expect(isReleased(null, "2026-06-02")).toBe(true);
  });
  it("release on/before today is released; future is not", () => {
    expect(isReleased("2026-06-02", "2026-06-02")).toBe(true);
    expect(isReleased("2026-06-01", "2026-06-02")).toBe(true);
    expect(isReleased("2026-06-03", "2026-06-02")).toBe(false);
  });
  it("hides a future-release lesson; shows released ones", () => {
    expect(isLessonHidden({ skipSequence: false, releaseDate: "2026-06-03", today: "2026-06-02" })).toBe(true);
    expect(isLessonHidden({ skipSequence: false, releaseDate: "2026-06-01", today: "2026-06-02" })).toBe(false);
  });
  it("never hides a skip_sequence (always-available) lesson", () => {
    expect(isLessonHidden({ skipSequence: true, releaseDate: "2026-12-25", today: "2026-06-02" })).toBe(false);
  });
});

describe("isLessonLocked", () => {
  const ordered = ["a", "b", "c", "d"];

  it("non-sequential cohorts never lock", () => {
    expect(
      isLessonLocked({
        sequential: false,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(),
        completedLessonIds: new Set(),
        lessonId: "d",
      }),
    ).toBe(false);
  });

  it("the first lesson is never locked", () => {
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(),
        completedLessonIds: new Set(),
        lessonId: "a",
      }),
    ).toBe(false);
  });

  it("locks until the immediately-prior sequenced lesson is complete", () => {
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(),
        completedLessonIds: new Set(["a"]),
        lessonId: "b",
      }),
    ).toBe(false);
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(),
        completedLessonIds: new Set(),
        lessonId: "b",
      }),
    ).toBe(true);
  });

  it("skips over skip_sequence predecessors when deciding the lock", () => {
    // c's immediate predecessor b is skip_sequence → look back to a.
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(["b"]),
        completedLessonIds: new Set(["a"]),
        lessonId: "c",
      }),
    ).toBe(false);
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(["b"]),
        completedLessonIds: new Set(),
        lessonId: "c",
      }),
    ).toBe(true);
  });

  it("a skip_sequence lesson is itself never locked", () => {
    expect(
      isLessonLocked({
        sequential: true,
        orderedLessonIds: ordered,
        skipSequenceIds: new Set(["d"]),
        completedLessonIds: new Set(),
        lessonId: "d",
      }),
    ).toBe(false);
  });
});

describe("lessonProgressStatus", () => {
  it("completed when all questions answered", () => {
    expect(lessonProgressStatus(3, 3)).toBe("completed");
  });
  it("started when some answered", () => {
    expect(lessonProgressStatus(3, 1)).toBe("started");
  });
  it("not_started when none answered", () => {
    expect(lessonProgressStatus(3, 0)).toBe("not_started");
  });
  it("zero-question lessons are excluded (null)", () => {
    expect(lessonProgressStatus(0, 0)).toBeNull();
  });
});
