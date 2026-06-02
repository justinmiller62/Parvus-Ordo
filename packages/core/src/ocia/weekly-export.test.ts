import { describe, expect, it } from "vitest";
import {
  SYSTEM_DEFAULT_DISCUSSION_TEMPLATE,
  type AssembleInput,
  assembleWeeklyExport,
  htmlToPlainText,
  renderWeeklyExportMarkdown,
} from "@parvaordo/core";

// ── htmlToPlainText ──────────────────────────────────────────────────────────

describe("htmlToPlainText", () => {
  it("strips tags so <p>Hi</p> becomes Hi (acceptance criterion)", () => {
    expect(htmlToPlainText("<p>Hi</p>")).toBe("Hi");
  });

  it("keeps inline text and separates paragraphs with a newline (no word-gluing)", () => {
    expect(htmlToPlainText("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(htmlToPlainText("<p>A</p><p>B</p>")).toBe("A\nB");
  });

  it("turns list items into bullets and <br> into newlines", () => {
    expect(htmlToPlainText("Line1<br>Line2")).toBe("Line1\nLine2");
    const list = htmlToPlainText("<ul><li>One</li><li>Two</li></ul>");
    expect(list).toContain("- One");
    expect(list).toContain("- Two");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToPlainText("Tom &amp; Jerry &lt;3 &quot;hi&quot;")).toBe('Tom & Jerry <3 "hi"');
  });

  it("returns empty string for empty/whitespace-only content", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText("<p>  </p>")).toBe("");
  });
});

// ── assembleWeeklyExport ─────────────────────────────────────────────────────

// s1=Alice (p1), s2=<no name → Unknown> (p1), s3=Carol (p2).
const PATHS = [
  { path_id: "p1", name: "Adults" },
  { path_id: "p2", name: "Teens" },
  { path_id: "p3", name: "No-Lesson" }, // has no week lesson → must be skipped
];
const MEMBERS = [
  { path_id: "p1", student_id: "s1" },
  { path_id: "p1", student_id: "s2" },
  { path_id: "p2", student_id: "s3" },
];
// V1 (lesson L1): reading, Q1 (iq1), Q2 (iq2). V2 (lesson L2): reading, QB (iqB).
const ITEMS: AssembleInput["items"] = [
  { version_id: "V1", id: "ir1", position: 0, kind: "reading", content: { html: "<p>Hello <b>world</b></p>" } },
  { version_id: "V1", id: "iq1", position: 1, kind: "question", content: { prompt: "Q1?" } },
  { version_id: "V1", id: "iq2", position: 2, kind: "question", content: { prompt: "Q2?" } },
  { version_id: "V2", id: "ir2", position: 0, kind: "reading", content: { html: "<p>Two</p>" } },
  { version_id: "V2", id: "iqB", position: 1, kind: "question", content: { prompt: "QB?" } },
];
const ANSWERS = [
  { item_id: "iq1", student_id: "s1", text: "A1", display_name: "Alice" },
  { item_id: "iq1", student_id: "s2", text: "A2", display_name: null }, // → Unknown
  { item_id: "iq1", student_id: "s3", text: "A3", display_name: "Carol" }, // p2 member
  { item_id: "iqB", student_id: "s3", text: "AB", display_name: "Carol" },
];
const SQ = [
  { lesson_id: "L1", student_id: "s1", text: "SQ-Alice", display_name: "Alice" },
  { lesson_id: "L1", student_id: "s3", text: "SQ-Carol", display_name: "Carol" }, // other path
];
const SF = [{ lesson_id: "L1", student_id: "s2", text: "FB", display_name: null }];

function mkInput(weekLessons: AssembleInput["weekLessons"]): AssembleInput {
  return {
    cohortId: "c1",
    cohortName: "Fall OCIA",
    week: 3,
    paths: PATHS,
    weekLessons,
    items: ITEMS,
    members: MEMBERS,
    answers: ANSWERS,
    studentQuestions: SQ,
    studentFeedback: SF,
  };
}

const WL_P1: AssembleInput["weekLessons"][number] = {
  path_id: "p1",
  lesson_id: "L1",
  version_id: "V1",
  title: "Lesson One",
  description: "About One.",
  discussion_template: "CUSTOM-L1",
};
const WL_P2: AssembleInput["weekLessons"][number] = {
  path_id: "p2",
  lesson_id: "L2",
  version_id: "V2",
  title: "Lesson Two",
  description: null,
  discussion_template: null,
};

describe("assembleWeeklyExport — single path", () => {
  const ex = assembleWeeklyExport(mkInput([WL_P1]));

  it("renders exactly the one path that has a week lesson (p3 skipped)", () => {
    expect(ex.paths).toHaveLength(1);
    expect(ex.paths[0]!.pathName).toBe("Adults");
  });

  it("filters answers to the path's members and falls back to Unknown for missing names", () => {
    const q1 = ex.paths[0]!.questions.find((q) => q.prompt === "Q1?")!;
    // s3 (Carol, in p2) answered iq1 but is NOT a p1 member → excluded.
    expect(q1.answers).toEqual([
      { studentName: "Alice", text: "A1" },
      { studentName: "Unknown", text: "A2" },
    ]);
  });

  it("leaves a question with no path-member answers empty", () => {
    const q2 = ex.paths[0]!.questions.find((q) => q.prompt === "Q2?")!;
    expect(q2.answers).toEqual([]);
  });

  it("HTML-strips reading blocks and excludes video (only reading+question passed)", () => {
    expect(ex.paths[0]!.readingBlocks).toEqual(["Hello world"]);
  });

  it("path-filters student questions and feedback", () => {
    expect(ex.paths[0]!.studentQuestions).toEqual([{ studentName: "Alice", text: "SQ-Alice" }]);
    expect(ex.paths[0]!.studentFeedback).toEqual([{ studentName: "Unknown", text: "FB" }]);
  });

  it("counts answers and honors the single lesson's discussion template", () => {
    expect(ex.paths[0]!.answerCount).toBe(2);
    expect(ex.totalAnswers).toBe(2);
    expect(ex.template).toBe("CUSTOM-L1");
  });
});

describe("assembleWeeklyExport — multiple paths, distinct lessons", () => {
  const ex = assembleWeeklyExport(mkInput([WL_P1, WL_P2]));

  it("includes both paths in order with their own lessons", () => {
    expect(ex.paths.map((p) => p.pathName)).toEqual(["Adults", "Teens"]);
    expect(ex.paths[1]!.lessonTitle).toBe("Lesson Two");
  });

  it("sums answers across paths and falls back to the system default template", () => {
    expect(ex.paths[1]!.answerCount).toBe(1); // Carol's AB
    expect(ex.totalAnswers).toBe(3); // 2 (p1) + 1 (p2)
    expect(ex.template).toBe(SYSTEM_DEFAULT_DISCUSSION_TEMPLATE);
  });
});

describe("assembleWeeklyExport — two paths sharing one lesson", () => {
  // Both paths point at L1/V1; each card shows only its own members' answers.
  const ex = assembleWeeklyExport(mkInput([WL_P1, { ...WL_P2, lesson_id: "L1", version_id: "V1", title: "Lesson One" }]));

  it("attributes shared-lesson answers per path membership", () => {
    const adults = ex.paths.find((p) => p.pathName === "Adults")!;
    const teens = ex.paths.find((p) => p.pathName === "Teens")!;
    expect(adults.questions.find((q) => q.prompt === "Q1?")!.answers.map((a) => a.text)).toEqual(["A1", "A2"]);
    expect(teens.questions.find((q) => q.prompt === "Q1?")!.answers).toEqual([{ studentName: "Carol", text: "A3" }]);
  });

  it("treats a single distinct lesson as eligible for the lesson-level template", () => {
    expect(ex.template).toBe("CUSTOM-L1");
  });
});

// ── renderWeeklyExportMarkdown ───────────────────────────────────────────────

describe("renderWeeklyExportMarkdown", () => {
  it("begins with the template, then ---, then the Week heading", () => {
    const md = renderWeeklyExportMarkdown(assembleWeeklyExport(mkInput([WL_P1])));
    expect(md.startsWith("CUSTOM-L1\n\n---\n\n# Week 3 Discussion — Fall OCIA")).toBe(true);
  });

  it("omits the Path heading and multi-path note for a single path", () => {
    const md = renderWeeklyExportMarkdown(assembleWeeklyExport(mkInput([WL_P1])));
    expect(md).not.toContain("## Path:");
    expect(md).not.toContain("learning paths.");
    expect(md).toContain("### Lesson One");
    expect(md).toContain("#### Lesson Material");
    expect(md).toContain("Hello world");
    expect(md).toContain("**Q: Q1?**");
    expect(md).toContain("- Alice: A1");
    expect(md).toContain("*No answers submitted.*"); // Q2
    expect(md).toContain("#### Student Questions");
    expect(md).toContain("- SQ-Alice — Alice");
    expect(md).toContain("#### Student Feedback");
    expect(md).toContain("- FB — Unknown");
  });

  it("includes the multi-path note and a Path heading per path for 2+ paths", () => {
    const md = renderWeeklyExportMarkdown(assembleWeeklyExport(mkInput([WL_P1, WL_P2])));
    expect(md).toContain("This week spans 2 learning paths.");
    expect(md).toContain("## Path: Adults");
    expect(md).toContain("## Path: Teens");
  });
});
