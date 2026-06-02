import type { ContentTypeStat, EngagementSummary, QuestionStat, StepStat, StudentStat } from "@parvaordo/core";
import { CheckCircle2, Clock, ListChecks, Users } from "lucide-react";

const CARD = "rounded-lg border border-gray-200 bg-white p-5";

/** `<1s` / `{n}s` / `{m}m {s}s` — the legacy formatMs rules. */
export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return "<1s";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Summary cards ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className={`${CARD} animate-[po-fade-in_200ms_ease-out]`}>
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 font-heading text-3xl text-navy tabular-nums" data-testid={testId}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-sm text-gray-500">{sub}</div> : null}
    </div>
  );
}

export function SummaryCards({ s }: { s: EngagementSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        icon={<Users className="h-4 w-4" />}
        label="Students"
        value={String(s.studentsStarted)}
        sub="started the lesson"
        testId="engagement-students"
      />
      <StatCard
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Completed"
        value={String(s.studentsCompleted)}
        sub={`${pct(s.completionRate)} completion`}
        testId="engagement-completed"
      />
      <StatCard
        icon={<Clock className="h-4 w-4" />}
        label="Avg time"
        value={formatMs(s.avgDurationMs)}
        sub="start to finish"
      />
      <StatCard icon={<ListChecks className="h-4 w-4" />} label="Events" value={String(s.totalEvents)} sub="recorded" />
    </div>
  );
}

// ── Completion donut ───────────────────────────────────────────────────────────

export function CompletionDonut({
  completed,
  inProgress,
  rate,
}: {
  completed: number;
  inProgress: number;
  rate: number;
}) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = Math.max(0, Math.min(1, rate)) * C;
  return (
    <div className={`${CARD} animate-[po-slide-up_240ms_ease-out]`}>
      <h3 className="font-heading text-lg text-navy">Completion</h3>
      <div className="mt-3 flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="12"
              className="text-gray-100"
              stroke="currentColor"
            />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="12"
              strokeLinecap="round"
              className="text-gold"
              stroke="currentColor"
              strokeDasharray={`${dash} ${C - dash}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-heading text-2xl text-navy tabular-nums">{pct(rate)}</span>
          </div>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gold" />
            <dt className="text-gray-500">Completed</dt>
            <dd className="font-medium text-navy tabular-nums">{completed}</dd>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
            <dt className="text-gray-500">In progress</dt>
            <dd className="font-medium text-navy tabular-nums">{inProgress}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// ── Horizontal bars (content-type + per-step timing) ───────────────────────────

function BarRow({
  label,
  valueMs,
  max,
  colorClass,
}: {
  label: string;
  valueMs: number;
  max: number;
  colorClass: string;
}) {
  const width = max > 0 ? Math.max(2, (valueMs / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm text-navy" title={label}>
        {label}
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`absolute inset-y-0 left-0 origin-left rounded-full ${colorClass} animate-[po-grow-x_600ms_ease-out]`}
          style={{ width: `${width}%` }}
          title={formatMs(valueMs)}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-500">{formatMs(valueMs)}</span>
    </div>
  );
}

const KIND_COLOR: Record<string, string> = { video: "bg-burgundy", reading: "bg-gold", question: "bg-navy" };

export function ContentTypeBars({ data }: { data: ContentTypeStat[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.avgMs));
  return (
    <div className={`${CARD} animate-[po-slide-up_240ms_ease-out]`}>
      <h3 className="font-heading text-lg text-navy">Avg time by content type</h3>
      <div className="mt-4 space-y-3">
        {data.map((d) => (
          <BarRow
            key={d.kind}
            label={`${d.kind[0]!.toUpperCase()}${d.kind.slice(1)}`}
            valueMs={d.avgMs}
            max={max}
            colorClass={KIND_COLOR[d.kind] ?? "bg-gold"}
          />
        ))}
      </div>
    </div>
  );
}

export function PerStepBars({ steps }: { steps: StepStat[] }) {
  if (steps.length === 0) return null;
  const max = Math.max(...steps.map((s) => s.avgMs));
  return (
    <div className={`${CARD} animate-[po-slide-up_240ms_ease-out]`}>
      <h3 className="font-heading text-lg text-navy">Avg time per step</h3>
      <div className="mt-4 space-y-3">
        {steps.map((s) => (
          <BarRow
            key={s.itemId ?? `${s.stepIndex}-${s.stepKind}`}
            label={`${s.stepIndex + 1}. ${s.label}`}
            valueMs={s.avgMs}
            max={max}
            colorClass={KIND_COLOR[s.stepKind] ?? "bg-gold"}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tables ─────────────────────────────────────────────────────────────────────

function accuracyClass(rate: number): string {
  if (rate >= 0.7) return "text-emerald-600";
  if (rate >= 0.4) return "text-amber-600";
  return "text-rose";
}

export function QuestionTable({ questions }: { questions: QuestionStat[] }) {
  if (questions.length === 0) return null;
  return (
    <div className={`${CARD} animate-[po-fade-in_240ms_ease-out] overflow-hidden p-0`}>
      <h3 className="border-b border-gray-100 px-5 py-3 font-heading text-lg text-navy">Question analytics</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="engagement-question-table">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <th className="px-5 py-2.5">Question</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5 text-right">Responses</th>
              <th className="px-3 py-2.5 text-right">Avg time</th>
              <th className="px-5 py-2.5 text-right">Accuracy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {questions.map((q) => (
              <tr key={q.itemId} className="transition hover:bg-parchment">
                <td className="max-w-xs px-5 py-3 text-navy">
                  <span className="line-clamp-2">{q.prompt}</span>
                </td>
                <td className="px-3 py-3 text-gray-500">
                  {q.questionType === "multiple_choice" ? "Multiple choice" : "Open-ended"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-700">{q.submissions}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-700">{formatMs(q.avgAnswerMs)}</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {q.accuracyRate == null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    <span className={`font-semibold ${accuracyClass(q.accuracyRate)}`}>{pct(q.accuracyRate)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StudentTable({ students }: { students: StudentStat[] }) {
  return (
    <div className={`${CARD} animate-[po-fade-in_240ms_ease-out] overflow-hidden p-0`}>
      <h3 className="border-b border-gray-100 px-5 py-3 font-heading text-lg text-navy">Student progress</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="engagement-student-table">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <th className="px-5 py-2.5">Student</th>
              <th className="px-3 py-2.5 text-right">Steps</th>
              <th className="px-3 py-2.5 text-right">Questions</th>
              <th className="px-3 py-2.5 text-right">Time</th>
              <th className="px-5 py-2.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {students.map((st) => (
              <tr key={st.studentId} className="transition hover:bg-parchment" data-testid="engagement-student-row">
                <td className="px-5 py-3 font-medium text-navy">{st.displayName}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-700">{st.stepsCompleted}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-700">{st.questionsAnswered}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-700">{formatMs(st.totalMs)}</td>
                <td className="px-5 py-3 text-right">
                  {st.completed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-dark">
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      In progress
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
