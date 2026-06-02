import { describe, expect, it } from "vitest";
import { computeAnswerCorrect, stepLabel } from "./engagement";

describe("computeAnswerCorrect", () => {
  const mc = {
    format: "multiple_choice",
    choices: [
      { label: "Son of the living God", correct: true },
      { label: "A prophet", correct: false },
    ],
  };

  it("true when the answer matches the correct choice label", () => {
    expect(computeAnswerCorrect(mc, "Son of the living God")).toBe(true);
  });

  it("false when the answer matches a wrong choice", () => {
    expect(computeAnswerCorrect(mc, "A prophet")).toBe(false);
  });

  it("false when the answer matches no choice", () => {
    expect(computeAnswerCorrect(mc, "Something else")).toBe(false);
  });

  it("treats bare-string choices as never-correct (legacy parity)", () => {
    expect(computeAnswerCorrect({ format: "multiple_choice", choices: ["a", "b"] }, "a")).toBe(false);
  });

  it("null for open-ended (no correctness notion)", () => {
    expect(computeAnswerCorrect({ format: "open_ended", expected_answer: "x" }, "x")).toBeNull();
  });

  it("null when no format is set", () => {
    expect(computeAnswerCorrect({ prompt: "?" }, "anything")).toBeNull();
  });
});

describe("stepLabel", () => {
  it("shows a question's prompt", () => {
    expect(stepLabel("question", "Who do you say that I am?", 2)).toBe("Who do you say that I am?");
  });

  it("truncates a long prompt to 50 chars with an ellipsis", () => {
    const long = "x".repeat(80);
    const out = stepLabel("question", long, 0);
    expect(out).toBe(`${"x".repeat(50)}…`);
  });

  it("falls back to 'Question' for an empty prompt", () => {
    expect(stepLabel("question", "  ", 0)).toBe("Question");
  });

  it("labels reading and video by kind", () => {
    expect(stepLabel("reading", null, 0)).toBe("Reading");
    expect(stepLabel("video", null, 1)).toBe("Video");
  });

  it("falls back to the 1-based step number for other kinds", () => {
    expect(stepLabel("feedback", null, 4)).toBe("Step 5");
  });
});
