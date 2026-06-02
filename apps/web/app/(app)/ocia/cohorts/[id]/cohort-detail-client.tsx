"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type {
  AddableLesson,
  CohortSettings,
  CohortStudentProgress,
  MergedEvent,
  ParishStudent,
  PathDetail,
  PublishedLessonRow,
  ScheduleEntry,
} from "@parvaordo/core";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  GraduationCap,
  ListChecks,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { formatCalendarDate } from "@/src/lib/calendar-date";
import {
  addScheduleEntryAction,
  deleteCohortAction,
  generateScheduleAction,
  removeScheduleEntryAction,
  setSequentialAction,
  toggleMemberAction,
  updateScheduleEntryAction,
  updateSettingsAction,
} from "./actions";
import { CohortCalendar } from "./cohort-calendar";
import { LearningPathsTab } from "./learning-paths-client";

// Weekdays declared locally so this client never value-imports from @parvaordo/core.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const input =
  "rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";

type Tab = "lessons" | "schedule" | "calendar" | "students" | "paths" | "settings";
const TABS: { key: Tab; label: string; Icon: typeof Users }[] = [
  { key: "lessons", label: "Lessons", Icon: ListChecks },
  { key: "schedule", label: "Schedule", Icon: CalendarPlus },
  { key: "calendar", label: "Calendar", Icon: CalendarDays },
  { key: "students", label: "Students", Icon: GraduationCap },
  { key: "paths", label: "Learning Paths", Icon: Sparkles },
  { key: "settings", label: "Settings", Icon: Settings2 },
];

export function CohortDetailClient(props: {
  cohortId: string;
  settings: CohortSettings;
  schedule: ScheduleEntry[];
  scheduleEvents: MergedEvent[];
  addable: AddableLesson[];
  allLessons: PublishedLessonRow[];
  students: CohortStudentProgress[];
  roster: ParishStudent[];
  paths: PathDetail[];
  canDelete: boolean;
}) {
  const { cohortId, settings } = props;
  const [tab, setTab] = useState<Tab>("lessons");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          href="/ocia/cohorts"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 transition hover:text-burgundy"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Cohorts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl text-navy">{settings.name}</h1>
          {settings.sequential ? (
            <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">Gated · in order</span>
          ) : (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-dark">Open order</span>
          )}
          <Link
            href={`/ocia/cohorts/${cohortId}/engagement`}
            data-testid="cohort-engagement-link"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-parchment"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Engagement
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? "border-burgundy text-burgundy" : "border-transparent text-gray-500 hover:text-navy"
            }`}
          >
            <t.Icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-[po-fade-in_200ms_ease-out]">
        {tab === "lessons" ? <LessonsTab cohortId={cohortId} schedule={props.schedule} /> : null}
        {tab === "schedule" ? (
          <ScheduleTab cohortId={cohortId} settings={settings} schedule={props.schedule} addable={props.addable} />
        ) : null}
        {tab === "calendar" ? <CohortCalendar events={props.scheduleEvents} /> : null}
        {tab === "students" ? <StudentsTab students={props.students} /> : null}
        {tab === "paths" ? (
          <LearningPathsTab cohortId={cohortId} paths={props.paths} allLessons={props.allLessons} />
        ) : null}
        {tab === "settings" ? (
          <SettingsTab cohortId={cohortId} settings={settings} roster={props.roster} canDelete={props.canDelete} />
        ) : null}
      </div>
    </div>
  );
}

// ── Lessons (read-only overview) ─────────────────────────────────────────────

function LessonsTab({ cohortId, schedule }: { cohortId: string; schedule: ScheduleEntry[] }) {
  if (schedule.length === 0) {
    return (
      <EmptyState
        title="No lessons scheduled"
        body="Go to the Schedule tab to auto-generate a weekly plan or add lessons one at a time."
      />
    );
  }
  return (
    <ul className="space-y-3" data-testid="lessons-overview">
      {schedule.map((e) => (
        <li
          key={e.id}
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-white p-4 ${
            e.isPast ? "opacity-60" : ""
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy/10 font-heading text-sm font-semibold text-burgundy">
            {e.weekNumber ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-navy">{e.title}</p>
            <p className="text-sm text-gray-500">
              {formatCalendarDate(e.discussionDate, { weekday: "long", month: "long", day: "numeric" })}
              {e.effectiveTime ? ` · ${e.effectiveTime}` : ""}
              {e.effectiveLocation ? ` · ${e.effectiveLocation}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 text-xs">
            <Link
              href={`/ocia/lessons/${e.lessonId}`}
              className="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 transition hover:bg-parchment"
            >
              Open
            </Link>
            <Link
              href={`/ocia/lessons/${e.lessonId}/responses`}
              className="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 transition hover:bg-parchment"
            >
              Responses
            </Link>
            <Link
              href={`/ocia/cohorts/${cohortId}/lessons/${e.lessonId}/engagement`}
              className="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 transition hover:bg-parchment"
              data-testid="lesson-engagement-link"
            >
              Engagement
            </Link>
            {e.weekNumber != null ? (
              <Link
                href={`/ocia/cohorts/${cohortId}/week/${e.weekNumber}/export`}
                className="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 transition hover:bg-parchment"
                data-testid="week-export"
                title={`Export week ${e.weekNumber} discussion bundle`}
              >
                Export
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Schedule (builder) ───────────────────────────────────────────────────────

function ScheduleTab({
  cohortId,
  settings,
  schedule,
  addable,
}: {
  cohortId: string;
  settings: CohortSettings;
  schedule: ScheduleEntry[];
  addable: AddableLesson[];
}) {
  const [pending, startTransition] = useTransition();
  const [addLessonId, setAddLessonId] = useState("");
  const canGenerate = !!settings.startDate && !!settings.discussionDay;

  function generate() {
    if (!canGenerate || pending) return;
    if (
      schedule.length > 0 &&
      !confirm("Auto-Generate replaces the entire current schedule (and any per-week edits). Continue?")
    ) {
      return;
    }
    startTransition(() => generateScheduleAction(cohortId));
  }
  function add() {
    if (!addLessonId || pending) return;
    const id = addLessonId;
    setAddLessonId("");
    startTransition(() => addScheduleEntryAction(cohortId, id));
  }

  return (
    <div className="space-y-5">
      <MeetingPatternFields cohortId={cohortId} settings={settings} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate || pending}
          title={canGenerate ? "" : "Set a start date and discussion day first"}
          data-testid="schedule-generate"
          className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-medium text-white transition hover:bg-gold-dark disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4" /> Auto-Generate
        </button>
        <span className="text-xs text-gray-400">
          Pairs each published lesson with a weekly {settings.discussionDay ?? "—"} date.
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={addLessonId}
            onChange={(e) => setAddLessonId(e.target.value)}
            data-testid="schedule-add-select"
            className={input}
          >
            <option value="">Add a lesson…</option>
            {addable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({l.scope})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={!addLessonId || pending}
            data-testid="schedule-add"
            className="rounded-md border border-gray-300 px-2.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-parchment disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {schedule.length === 0 ? (
        <EmptyState title="No lessons scheduled" body="Use Auto-Generate or add lessons manually above." />
      ) : (
        <ul className="space-y-2" data-testid="schedule-rows">
          {schedule.map((e) => (
            <ScheduleRow key={e.id} cohortId={cohortId} entry={e} sequential={settings.sequential} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleRow({ cohortId, entry, sequential }: { cohortId: string; entry: ScheduleEntry; sequential: boolean }) {
  const [, startTransition] = useTransition();
  const save = (patch: Parameters<typeof updateScheduleEntryAction>[2]) =>
    startTransition(() => updateScheduleEntryAction(cohortId, entry.id, patch));

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`schedule-row-${entry.id}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-burgundy/10 text-xs font-semibold text-burgundy">
          {entry.weekNumber ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-navy">{entry.title}</span>
        <button
          type="button"
          onClick={() => startTransition(() => removeScheduleEntryAction(cohortId, entry.id))}
          className="text-gray-400 transition hover:text-rose"
          title="Remove from schedule"
          aria-label="Remove from schedule"
          data-testid={`schedule-remove-${entry.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Discussion">
          <input
            type="date"
            defaultValue={entry.discussionDate}
            className={`${input} w-full`}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== entry.discussionDate) save({ discussionDate: e.target.value });
            }}
          />
        </Field>
        <Field label="Release" hint={entry.releaseDate ? undefined : effectiveHint(entry.effectiveReleaseDate)}>
          <input
            type="date"
            defaultValue={entry.releaseDate ?? ""}
            className={`${input} w-full`}
            onBlur={(e) => save({ releaseDate: e.target.value || null })}
          />
        </Field>
        <Field label="Due" hint={entry.dueDate ? undefined : effectiveHint(entry.effectiveDueDate)}>
          <input
            type="date"
            defaultValue={entry.dueDate ?? ""}
            className={`${input} w-full`}
            onBlur={(e) => save({ dueDate: e.target.value || null })}
          />
        </Field>
        <Field label="Time" hint={entry.timeOverride ? undefined : "cohort default"}>
          <input
            type="text"
            defaultValue={entry.timeOverride ?? ""}
            placeholder={entry.effectiveTime ?? "7:00 PM"}
            className={`${input} w-full`}
            onBlur={(e) => save({ timeOverride: e.target.value || null })}
          />
        </Field>
        <Field label="Location" hint={entry.locationOverride ? undefined : "cohort default"}>
          <input
            type="text"
            defaultValue={entry.locationOverride ?? ""}
            placeholder={entry.effectiveLocation ?? "Parish Hall"}
            className={`${input} w-full`}
            onBlur={(e) => save({ locationOverride: e.target.value || null })}
          />
        </Field>
        {sequential ? (
          <label className="flex items-end gap-2 pb-1.5 text-sm text-navy">
            <input
              type="checkbox"
              defaultChecked={entry.skipSequence}
              onChange={(e) => save({ skipSequence: e.target.checked })}
              className="h-4 w-4 rounded border-navy/30 text-burgundy"
            />
            Always available
          </label>
        ) : null}
      </div>
    </li>
  );
}

// ── Students (progress) ──────────────────────────────────────────────────────

function StudentsTab({ students }: { students: CohortStudentProgress[] }) {
  if (students.length === 0) {
    return <EmptyState title="No students in this cohort" body="Add students from the Settings tab." />;
  }
  return (
    <ul className="space-y-2" data-testid="students-list">
      {students.map((s) => {
        const pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
        return (
          <li key={s.userId} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-navy">{s.displayName}</p>
                <p className="truncate text-xs text-gray-400">{s.email}</p>
              </div>
              <span className="shrink-0 text-sm font-medium text-gray-500">
                {s.completed}/{s.total}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Settings (meeting pattern + sequential + roster + delete) ────────────────

function SettingsTab({
  cohortId,
  settings,
  roster,
  canDelete,
}: {
  cohortId: string;
  settings: CohortSettings;
  roster: ParishStudent[];
  canDelete: boolean;
}) {
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <MeetingPatternFields cohortId={cohortId} settings={settings} includeName />

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium text-navy">Require lessons in order</span>
            <span className="block text-xs text-gray-400">
              Drip-release lessons and lock each until the previous one is complete.
            </span>
          </span>
          <input
            type="checkbox"
            defaultChecked={settings.sequential}
            data-testid="settings-sequential"
            onChange={(e) => startTransition(() => setSequentialAction(cohortId, e.target.checked))}
            className="h-5 w-5 rounded border-navy/30 text-burgundy"
          />
        </label>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-500">
          <Users className="h-4 w-4" /> Roster ({roster.filter((r) => r.inCohort).length})
        </h2>
        {roster.length === 0 ? (
          <p className="text-sm text-gray-500">No learners in this parish yet.</p>
        ) : (
          <ul
            className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white"
            data-testid="roster-list"
          >
            {roster.map((s) => (
              <li key={s.userId} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy">{s.displayName}</p>
                  <p className="truncate text-xs text-gray-400">{s.email}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-500">
                  {s.inCohort ? "Enrolled" : "Add"}
                  <input
                    type="checkbox"
                    defaultChecked={s.inCohort}
                    data-testid={`roster-toggle-${s.email}`}
                    onChange={(e) => startTransition(() => toggleMemberAction(cohortId, s.userId, e.target.checked))}
                    className="h-4 w-4 rounded border-navy/30 text-burgundy"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDelete ? (
        <section className="rounded-lg border border-rose/30 bg-rose/5 p-4">
          <p className="mb-2 text-sm font-medium text-rose">Danger zone</p>
          <button
            type="button"
            data-testid="cohort-delete"
            onClick={() => {
              if (confirm(`Delete “${settings.name}”? This removes its schedule, roster, and learning paths.`)) {
                startTransition(() => deleteCohortAction(cohortId));
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose/40 px-3 py-1.5 text-sm font-medium text-rose transition hover:bg-rose/10"
          >
            <Trash2 className="h-4 w-4" /> Delete cohort
          </button>
        </section>
      ) : null}
    </div>
  );
}

/** The meeting-pattern fields, autosaved on blur/change. Shared by Schedule + Settings. */
function MeetingPatternFields({
  cohortId,
  settings,
  includeName = false,
}: {
  cohortId: string;
  settings: CohortSettings;
  includeName?: boolean;
}) {
  const [, startTransition] = useTransition();
  // Local working copy so every save sends the full, current settings object.
  const [f, setF] = useState({
    name: settings.name,
    startDate: settings.startDate ?? "",
    endDate: settings.endDate ?? "",
    discussionDay: settings.discussionDay ?? "",
    discussionTime: settings.discussionTime ?? "",
    discussionLocation: settings.discussionLocation ?? "",
  });
  const save = (next: typeof f) =>
    startTransition(() =>
      updateSettingsAction(cohortId, {
        name: next.name,
        startDate: next.startDate || null,
        endDate: next.endDate || null,
        discussionDay: next.discussionDay || null,
        discussionTime: next.discussionTime || null,
        discussionLocation: next.discussionLocation || null,
      }),
    );
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
      {includeName ? (
        <Field label="Name" className="col-span-2 sm:col-span-3">
          <input
            value={f.name}
            data-testid="settings-name"
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => save(f)}
            className={`${input} w-full`}
          />
        </Field>
      ) : null}
      <Field label="Start date">
        <input
          type="date"
          value={f.startDate}
          data-testid="settings-start"
          onChange={(e) => set("startDate", e.target.value)}
          onBlur={() => save(f)}
          className={`${input} w-full`}
        />
      </Field>
      <Field label="End date">
        <input
          type="date"
          value={f.endDate}
          onChange={(e) => set("endDate", e.target.value)}
          onBlur={() => save(f)}
          className={`${input} w-full`}
        />
      </Field>
      <Field label="Discussion day">
        <select
          value={f.discussionDay}
          data-testid="settings-day"
          onChange={(e) => {
            const next = { ...f, discussionDay: e.target.value };
            setF(next);
            save(next);
          }}
          className={`${input} w-full`}
        >
          <option value="">—</option>
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Default time">
        <input
          value={f.discussionTime}
          placeholder="7:00 PM"
          onChange={(e) => set("discussionTime", e.target.value)}
          onBlur={() => save(f)}
          className={`${input} w-full`}
        />
      </Field>
      <Field label="Default location" className="col-span-2 sm:col-span-1">
        <input
          value={f.discussionLocation}
          placeholder="Parish Hall"
          onChange={(e) => set("discussionLocation", e.target.value)}
          onBlur={() => save(f)}
          className={`${input} w-full`}
        />
      </Field>
    </div>
  );
}

// ── small shared bits ────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-gray-400">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

function effectiveHint(date: string | null): string {
  return date ? `auto: ${formatCalendarDate(date, { month: "short", day: "numeric" })}` : "always released";
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-navy/20 bg-white/50 px-6 py-14 text-center">
      <p className="font-heading text-lg text-navy">{title}</p>
      <p className="max-w-sm text-sm text-gray-500">{body}</p>
    </div>
  );
}
