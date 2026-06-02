"use client";

import { Plus, X } from "lucide-react";

interface Choice {
  label: string;
  correct: boolean;
}

const INPUT =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export function QuestionEditor({
  content,
  onChange,
}: {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const prompt = String(content.prompt ?? "");
  const format = content.format === "multiple_choice" ? "multiple_choice" : "open_ended";
  const choices: Choice[] = Array.isArray(content.choices) ? (content.choices as Choice[]) : [];
  const expected = String(content.expected_answer ?? "");

  const patch = (next: Record<string, unknown>) => onChange({ ...content, prompt, format, ...next });

  return (
    <div className="space-y-3">
      <input
        value={prompt}
        onChange={(e) => patch({ prompt: e.target.value })}
        placeholder="Question prompt"
        className={INPUT}
      />

      <div className="flex gap-4 text-sm text-gray-700">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={format === "open_ended"}
            onChange={() => onChange({ prompt, format: "open_ended", expected_answer: expected })}
          />
          Open-ended
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={format === "multiple_choice"}
            onChange={() =>
              onChange({
                prompt,
                format: "multiple_choice",
                choices:
                  choices.length >= 2
                    ? choices
                    : [
                        { label: "", correct: true },
                        { label: "", correct: false },
                      ],
              })
            }
          />
          Multiple choice
        </label>
      </div>

      {format === "multiple_choice" ? (
        <div className="space-y-1.5">
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct-choice"
                title="Mark as correct"
                checked={c.correct}
                onChange={() => patch({ choices: choices.map((x, j) => ({ ...x, correct: j === i })) })}
              />
              <input
                value={c.label}
                onChange={(e) =>
                  patch({ choices: choices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                }
                placeholder={`Choice ${i + 1}`}
                className={INPUT}
              />
              <button
                type="button"
                onClick={() => {
                  if (choices.length <= 2) return; // multiple choice needs ≥2 options
                  const next = choices.filter((_, j) => j !== i);
                  // Keep exactly one correct answer if we removed the correct one.
                  if (!next.some((x) => x.correct) && next[0]) next[0] = { ...next[0], correct: true };
                  patch({ choices: next });
                }}
                disabled={choices.length <= 2}
                className="text-gray-400 hover:text-rose disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Remove choice"
                title={choices.length <= 2 ? "A multiple-choice question needs at least 2 options" : "Remove choice"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => patch({ choices: [...choices, { label: "", correct: choices.length === 0 }] })}
            className="inline-flex items-center gap-1 text-sm font-medium text-burgundy hover:text-rose"
          >
            <Plus className="h-3.5 w-3.5" />
            Add choice
          </button>
        </div>
      ) : (
        <input
          value={expected}
          onChange={(e) => patch({ expected_answer: e.target.value })}
          placeholder="Expected answer (optional — shown to catechists in preview)"
          className={INPUT}
        />
      )}
    </div>
  );
}
