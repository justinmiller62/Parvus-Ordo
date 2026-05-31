"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { submitFeedbackAction, submitQuestionAction } from "@/app/(app)/ocia/lessons/[id]/actions";

type SubmitAction = (lessonId: string, text: string) => Promise<{ ok: boolean }>;

function MessageForm({
  lessonId,
  kind,
  label,
  placeholder,
  action,
}: {
  lessonId: string;
  kind: "question" | "feedback";
  label: string;
  placeholder: string;
  action: SubmitAction;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="text-sm text-green-700" data-testid={`${kind}-sent`}>
        Sent! Your catechist will see this.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        startTransition(async () => {
          const r = await action(lessonId, text);
          if (r.ok) setSent(true);
        });
      }}
      className="space-y-2"
    >
      <label className="block text-sm font-medium text-navy">{label}</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={placeholder}
        data-testid={`${kind}-input`}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      />
      <button
        type="submit"
        disabled={pending || !text.trim()}
        data-testid={`${kind}-submit`}
        className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
        Send
      </button>
    </form>
  );
}

/** The "ask a question" + "leave feedback" forms shown on the completion screen. */
export function CompletionForms({ lessonId }: { lessonId: string }) {
  return (
    <div className="mx-auto mt-8 max-w-md space-y-6 text-left">
      <MessageForm
        lessonId={lessonId}
        kind="question"
        label="Ask your catechist a question"
        placeholder="Type your question…"
        action={submitQuestionAction}
      />
      <MessageForm
        lessonId={lessonId}
        kind="feedback"
        label="Leave feedback on this lesson"
        placeholder="Share your thoughts…"
        action={submitFeedbackAction}
      />
    </div>
  );
}
