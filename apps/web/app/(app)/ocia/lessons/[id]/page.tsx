import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { getAnswersForVersion, getCompletedItemsForVersion, getLessonDetail } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { advanceAction } from "./actions";

const CARD = "rounded-lg border border-gray-200 bg-white p-6";
const PROSE =
  "text-gray-900 leading-relaxed [&_p]:my-3 [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:my-3 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:my-3 [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-gold [&_blockquote]:pl-4 [&_blockquote]:italic [&_a]:text-burgundy [&_a]:underline";
const BACK_BTN =
  "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-parchment";
const PRIMARY_BTN =
  "inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 text-sm font-medium text-white hover:bg-gold-dark";

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; v?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const identity = viewer.identity;
  if (!identity?.parishId) redirect("/");

  const role = identity.role;
  const isBuilder = role === "catechist" || role === "admin" || role === "super_admin";

  const { id } = await params;
  const sp = await searchParams;
  // Students always see the live version; builders may preview a specific version (?v=).
  const lesson = await getLessonDetail(identity.parishId, id, isBuilder ? sp.v : undefined);
  if (!lesson) notFound();

  const items = lesson.items;
  const total = items.length;

  const [completed, answers] = await Promise.all([
    getCompletedItemsForVersion(identity.parishId, identity.userId, lesson.versionId),
    getAnswersForVersion(identity.parishId, identity.userId, lesson.versionId),
  ]);

  // Resume = first incomplete item; can revisit completed steps but not skip past it.
  let resume = 0;
  while (resume < total && completed.has(items[resume]!.id)) resume++;

  const requested = Number(sp.step);
  const wanted = Number.isFinite(requested) ? requested : resume;
  const current = Math.max(0, Math.min(wanted, resume));

  // ── Completion screen ──
  if (total === 0 || current >= total) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className={`${CARD} mt-10 text-center`}>
          <CheckCircle2 className="mx-auto h-10 w-10 text-gold" />
          <h1 className="mt-3 font-heading text-2xl text-navy">Lesson complete</h1>
          <p className="mt-1 text-gray-500">{lesson.title}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/" className={PRIMARY_BTN}>
              Back to dashboard
            </Link>
            {total > 0 ? (
              <Link href={`/ocia/lessons/${id}?step=0`} className={BACK_BTN}>
                Review
              </Link>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const item = items[current]!;
  const isActive = current === resume;
  const stepNum = current + 1;
  const isLast = current === total - 1;

  const prompt = String(item.content.prompt ?? "");
  const isMultipleChoice = item.content.format === "multiple_choice";
  const choices = Array.isArray(item.content.choices)
    ? (item.content.choices as Array<string | { label: string }>).map((c) =>
        typeof c === "string" ? c : c.label,
      )
    : [];
  const savedAnswer = answers[item.id] ?? "";

  const primaryLabel = item.kind === "question" ? "Submit & Continue" : isLast ? "Finish" : "Continue";

  // Card body for the current item.
  const body = (
    <div className={CARD}>
      {item.kind === "reading" ? (
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: String(item.content.html ?? "") }} />
      ) : item.kind === "video" ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-parchment p-10 text-center text-sm text-gray-400">
          ▶ Video player arrives in Slice 5 (Bunny).
        </div>
      ) : (
        <>
          <p className="mb-4 text-lg font-medium text-gray-900" data-testid="wizard-question-prompt">
            {prompt}
          </p>
          {!isActive ? (
            <div className="rounded-md bg-cream/20 px-3 py-2 text-sm text-navy">{savedAnswer}</div>
          ) : isMultipleChoice ? (
            <div className="space-y-2">
              {choices.map((c, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-gray-200 px-4 py-3 text-sm text-navy transition-all hover:border-gray-300 hover:bg-parchment has-[:checked]:border-gold has-[:checked]:bg-cream/20"
                >
                  <input
                    type="radio"
                    name="text"
                    value={c}
                    required
                    defaultChecked={savedAnswer === c}
                    className="h-4 w-4 accent-gold"
                  />
                  {c}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              name="text"
              required
              rows={6}
              defaultValue={savedAnswer}
              placeholder="Type your answer..."
              data-testid="wizard-answer-input"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          )}
        </>
      )}
    </div>
  );

  const backEl =
    current > 0 ? (
      <Link href={`/ocia/lessons/${id}?step=${current - 1}`} className={BACK_BTN} data-testid="wizard-back">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
    ) : (
      <span />
    );

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
        ← Lessons
      </Link>

      {/* Header */}
      <div className="mt-3 mb-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h1 className="font-heading text-xl text-navy">{lesson.title}</h1>
          <span className="shrink-0 text-sm text-gray-400">
            <span data-testid="wizard-step-current">{stepNum}</span> /{" "}
            <span data-testid="wizard-step-total">{total}</span>
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200">
          <div
            className="h-1.5 rounded-full bg-gold transition-all duration-300"
            style={{ width: `${(stepNum / total) * 100}%` }}
          />
        </div>
      </div>

      {isActive ? (
        <form action={advanceAction}>
          <input type="hidden" name="lessonId" value={id} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="kind" value={item.kind} />
          <input type="hidden" name="step" value={current} />
          {body}
          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
            {backEl}
            <button type="submit" className={PRIMARY_BTN} data-testid="wizard-next">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      ) : (
        <>
          {body}
          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
            {backEl}
            <Link href={`/ocia/lessons/${id}?step=${current + 1}`} className={PRIMARY_BTN} data-testid="wizard-next">
              Continue
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
