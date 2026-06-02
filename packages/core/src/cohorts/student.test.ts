import { describe, expect, it } from "vitest";
import { partitionStudentLessons, type StudentLesson } from "./student";

const lesson = (
  over: Partial<StudentLesson> & { lessonId: string; status: StudentLesson["status"] },
): StudentLesson => ({
  title: over.lessonId.toUpperCase(),
  cohortId: "c1",
  cohortName: "Cohort 1",
  discussionDate: "2026-06-02",
  dueDate: "2026-06-01",
  weekNumber: null,
  locked: false,
  ...over,
});

describe("partitionStudentLessons", () => {
  it("buckets completed lessons into `completed` and everything else into `due`", () => {
    const { due, completed } = partitionStudentLessons([
      lesson({ lessonId: "a", status: "not_started" }),
      lesson({ lessonId: "b", status: "completed" }),
      lesson({ lessonId: "c", status: "started" }),
    ]);
    expect(due.map((l) => l.lessonId)).toEqual(["a", "c"]);
    expect(completed.map((l) => l.lessonId)).toEqual(["b"]);
  });

  it("preserves the input (schedule) order within each section", () => {
    const { due, completed } = partitionStudentLessons([
      lesson({ lessonId: "c2", status: "completed" }),
      lesson({ lessonId: "d1", status: "started" }),
      lesson({ lessonId: "c1", status: "completed" }),
      lesson({ lessonId: "d2", status: "not_started" }),
    ]);
    expect(due.map((l) => l.lessonId)).toEqual(["d1", "d2"]);
    expect(completed.map((l) => l.lessonId)).toEqual(["c2", "c1"]);
  });

  it("keeps a locked (not-yet-completed) lesson in `due`", () => {
    const { due, completed } = partitionStudentLessons([
      lesson({ lessonId: "x", status: "not_started", locked: true }),
    ]);
    expect(due.map((l) => l.lessonId)).toEqual(["x"]);
    expect(completed).toEqual([]);
  });

  it("returns empty sections for an empty list", () => {
    expect(partitionStudentLessons([])).toEqual({ due: [], completed: [] });
  });

  it("an all-completed list yields an empty `due` (the All caught up! state)", () => {
    const { due, completed } = partitionStudentLessons([
      lesson({ lessonId: "a", status: "completed" }),
      lesson({ lessonId: "b", status: "completed" }),
    ]);
    expect(due).toEqual([]);
    expect(completed).toHaveLength(2);
  });

  it("a list with nothing completed yields an empty `completed`", () => {
    const { due, completed } = partitionStudentLessons([
      lesson({ lessonId: "a", status: "not_started" }),
      lesson({ lessonId: "b", status: "started" }),
    ]);
    expect(due).toHaveLength(2);
    expect(completed).toEqual([]);
  });
});
