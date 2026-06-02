import { isStaff } from "@parvaordo/shared";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye } from "lucide-react";
import {
  clipTranscript,
  getAnswersForVersion,
  getAsset,
  getCompletedItemsForVersion,
  getItemMaxReached,
  getLessonDetail,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { VideoPlayer, type PlayerWord } from "@/src/components/ocia/video-player";
import { VideoStep } from "@/src/components/ocia/video-step";
import { PreviewJumpTo } from "@/src/components/ocia/preview-nav";
import { CompletionForms } from "@/src/components/ocia/completion-forms";
import { advanceAction } from "./actions";

const CARD = "rounded-lg border border-gray-200 bg-white p-6";
const PROSE =
  "text-gray-900 leading-relaxed [&_p]:my-3 [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:my-3 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:my-3 [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-gold [&_blockquote]:pl-4 [&_blockquote]:italic [&_a]:text-burgundy [&_a]:underline";
const BACK_BTN =
  "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-parchment";
const PRIMARY_BTN =
  "inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 text-sm font-medium text-white hover:bg-gold-dark";

function itemLabel(item: { kind: string; content: Record<string, unknown> }): string {
  if (item.kind === "reading") return "Reading";
  if (item.kind === "video") return "Video";
  const p = String(item.content.prompt ?? "").trim();
  return p ? (p.length > 40 ? `${p.slice(0, 40)}…` : p) : "Question";
}

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; v?: string; preview?: string; review?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const identity = viewer.identity;
  if (!identity?.parishId) redirect("/");

  const role = identity.role;
  const isBuilder = isStaff(role);

  const { id } = await params;
  const sp = await searchParams;
  // Teacher PREVIEW is a distinct mode (Narthex parity): ungated, starts at the
  // beginning, free jump-to-section, no progress writes. Students get the linear,
  // progress-gated wizard. Builders preview a specific version (?v=).
  const isPreview = isBuilder && sp.preview === "1";
  const isReview = !isPreview && sp.review === "1"; // student's read-only "My Answers"
  const lesson = await getLessonDetail(identity.parishId, id, isBuilder ? sp.v : undefined);
  if (!lesson) notFound();

  const items = lesson.items;
  const total = items.length;

  const [completed, answers] = isPreview
    ? [new Set<string>(), {} as Record<string, string>]
    : await Promise.all([
        getCompletedItemsForVersion(identity.parishId, identity.userId, lesson.versionId),
        getAnswersForVersion(identity.parishId, identity.userId, lesson.versionId),
      ]);

  // ── Review mode: read-only "My Answers" ──
  if (isReview) {
    const questions = items.filter((i) => i.kind === "question");
    return (
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
          ← Lessons
        </Link>
        <h1 className="mt-3 mb-4 font-heading text-2xl text-navy">My Answers — {lesson.title}</h1>
        {questions.length === 0 ? (
          <p className="text-sm text-gray-500">This lesson has no questions.</p>
        ) : (
          <ul className="space-y-3" data-testid="review-list">
            {questions.map((q, i) => (
              <li key={q.id} className={CARD}>
                <p className="mb-2 font-medium text-gray-900">
                  {i + 1}. {String(q.content.prompt ?? "")}
                </p>
                {answers[q.id] ? (
                  <div className="rounded-md bg-cream/20 px-3 py-2 text-sm text-navy">{answers[q.id]}</div>
                ) : (
                  <p className="text-sm italic text-gray-400">No answer submitted</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  // Resume = first incomplete item (student only). Preview is never gated.
  let resume = 0;
  if (!isPreview) while (resume < total && completed.has(items[resume]!.id)) resume++;

  const requested = Number(sp.step);
  const wanted = Number.isFinite(requested) ? requested : isPreview ? 0 : resume;
  const ceiling = isPreview ? total - 1 : resume;
  const current = Math.max(0, Math.min(wanted, ceiling));

  const hrefFor = (step: number) =>
    isPreview
      ? `/ocia/lessons/${id}?preview=1${sp.v ? `&v=${sp.v}` : ""}&step=${step}`
      : `/ocia/lessons/${id}?step=${step}`;

  // ── Completion screen ──
  if (total === 0 || current >= total) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className={`${CARD} mt-10 text-center`}>
          <CheckCircle2 className="mx-auto h-10 w-10 text-gold" />
          <h1 className="mt-3 font-heading text-2xl text-navy">{isPreview ? "End of preview" : "Lesson complete"}</h1>
          <p className="mt-1 text-gray-500">{lesson.title}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href={isPreview ? `/ocia/lessons/${id}/edit${sp.v ? `?v=${sp.v}` : ""}` : "/ocia"}
              className={PRIMARY_BTN}
            >
              {isPreview ? "Back to editor" : "Back to OCIA Home"}
            </Link>
            {total > 0 ? (
              <Link
                href={isPreview ? hrefFor(0) : `/ocia/lessons/${id}?review=1`}
                className={BACK_BTN}
                data-testid="my-answers"
              >
                {isPreview ? "Restart preview" : "My Answers"}
              </Link>
            ) : null}
          </div>
          {!isPreview ? <CompletionForms lessonId={id} /> : null}
        </div>
      </main>
    );
  }

  const item = items[current]!;
  const isActive = !isPreview && current === resume;
  const stepNum = current + 1;
  const isLast = current === total - 1;

  const prompt = String(item.content.prompt ?? "");
  const isMultipleChoice = item.content.format === "multiple_choice";
  const rawChoices = Array.isArray(item.content.choices)
    ? (item.content.choices as Array<string | { label: string; correct?: boolean }>)
    : [];
  const choices = rawChoices.map((c) =>
    typeof c === "string" ? { label: c, correct: false } : { label: c.label, correct: !!c.correct },
  );
  const savedAnswer = answers[item.id] ?? "";
  const expected = String(item.content.expected_answer ?? "");

  // For a video item: prefer the physical cut clip (its own short video, so the
  // native player only sees the clip). Fall back to a client-enforced window of the
  // source when no real clip exists yet (also the local/stub path, where the stub
  // "clip" reuses the source URL).
  let playerProps: { src: string; startMs: number; endMs: number | null; words: PlayerWord[] } | null = null;
  let videoNode: ReactNode = null;
  if (item.kind === "video") {
    const sourceId = item.content.asset_id as string | undefined;
    const clipId = item.content.clip_asset_id as string | undefined;
    const startMs = Number(item.content.start_ms ?? 0);
    const endMs = item.content.end_ms == null ? null : Number(item.content.end_ms);
    const source = sourceId ? await getAsset(identity.parishId, sourceId) : null;
    const clip = clipId ? await getAsset(identity.parishId, clipId) : null;
    const startSec = startMs / 1000;

    const realClip =
      clip?.status === "ready" && clip.playbackUrl && clip.playbackUrl !== source?.playbackUrl ? clip : null;

    if (realClip) {
      // The clip IS the window; transcript rebased to clip-relative time.
      const words = clipTranscript(source?.transcriptJson ?? [], startMs, endMs).map((w) => ({
        word: w.word,
        start: Math.max(0, w.start - startSec),
        end: Math.max(0, w.end - startSec),
      }));
      playerProps = { src: realClip.playbackUrl!, startMs: 0, endMs: null, words };
    } else if (source?.playbackUrl) {
      const words = clipTranscript(source.transcriptJson ?? [], startMs, endMs);
      playerProps = { src: source.playbackUrl, startMs, endMs, words };
    }
    videoNode = playerProps ? (
      <VideoPlayer {...playerProps} unlocked={isPreview} />
    ) : (
      <div className="rounded-lg border-2 border-dashed border-gray-200 bg-parchment p-10 text-center text-sm text-gray-400">
        This video isn’t ready yet.
      </div>
    );
  }

  // Resume position for the active student video step.
  const savedMaxReached =
    isActive && item.kind === "video" ? await getItemMaxReached(identity.parishId, identity.userId, item.id) : 0;

  const primaryLabel = item.kind === "question" ? "Submit & Continue" : isLast ? "Finish" : "Continue";

  // Card body for the current item.
  const body = (
    <div className={CARD}>
      {item.kind === "reading" ? (
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: String(item.content.html ?? "") }} />
      ) : item.kind === "video" ? (
        videoNode
      ) : (
        <>
          <p className="mb-4 text-lg font-medium text-gray-900" data-testid="wizard-question-prompt">
            {prompt}
          </p>
          {isPreview ? (
            // Read-only review with the answer key surfaced.
            isMultipleChoice ? (
              <div className="space-y-2">
                {choices.map((c, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
                      c.correct ? "border-gold bg-cream/20 text-navy" : "border-gray-200 text-gray-600"
                    }`}
                  >
                    {c.correct ? <CheckCircle2 className="h-4 w-4 text-gold" /> : <span className="w-4" />}
                    {c.label}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-cream/20 px-3 py-2 text-sm text-navy">
                {expected ? (
                  <span>
                    <span className="font-medium">Expected answer:</span> {expected}
                  </span>
                ) : (
                  <span className="italic text-gray-400">Open-ended response</span>
                )}
              </div>
            )
          ) : !isActive ? (
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
                    value={c.label}
                    required
                    defaultChecked={savedAnswer === c.label}
                    className="h-4 w-4 accent-gold"
                  />
                  {c.label}
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
      <Link href={hrefFor(current - 1)} className={BACK_BTN} data-testid="wizard-back">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
    ) : (
      <span />
    );

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href={isPreview ? `/ocia/lessons/${id}/edit${sp.v ? `?v=${sp.v}` : ""}` : "/ocia/lessons"}
        className="text-sm text-gray-400 hover:text-navy"
      >
        ← {isPreview ? "Editor" : "Lessons"}
      </Link>

      {isPreview ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gold/40 bg-cream/20 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gold-dark">
            <Eye className="h-4 w-4" />
            Preview — teacher view, not gated
          </span>
          <PreviewJumpTo lessonId={id} versionId={sp.v} current={current} labels={items.map(itemLabel)} />
        </div>
      ) : null}

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

      {isActive && item.kind === "video" && playerProps ? (
        <VideoStep
          src={playerProps.src}
          startMs={playerProps.startMs}
          endMs={playerProps.endMs}
          words={playerProps.words}
          itemId={item.id}
          lessonId={id}
          step={current}
          initialMaxReachedMs={savedMaxReached}
          backHref={current > 0 ? hrefFor(current - 1) : undefined}
        />
      ) : isActive ? (
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
            <Link href={hrefFor(current + 1)} className={PRIMARY_BTN} data-testid="wizard-next">
              {isPreview && isLast ? "Finish" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
