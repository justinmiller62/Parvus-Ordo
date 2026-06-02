"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarRange, Plus, Users } from "lucide-react";
import { formatCalendarDate } from "@/src/lib/calendar-date";
import { createCohortAction } from "./actions";

export interface CohortCardView {
  id: string;
  name: string;
  discussionDay: string | null;
  discussionTime: string | null;
  studentCount: number;
  lessonCount: number;
  nextDiscussion: string | null;
}

export function CohortsListClient({ cohorts, canCreate }: { cohorts: CohortCardView[]; canCreate: boolean }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      await createCohortAction(trimmed);
      setName("");
    });
  }

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="New cohort name (e.g. OCIA 2026–2027)"
            data-testid="cohort-name"
            className="flex-1 rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
          />
          <button
            type="button"
            onClick={create}
            disabled={pending || !name.trim()}
            data-testid="cohort-create"
            className="inline-flex items-center gap-1 rounded-md bg-burgundy px-3 py-2 text-sm font-medium text-cream transition hover:bg-rose disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {pending ? "Creating…" : "Create cohort"}
          </button>
        </div>
      ) : null}

      {cohorts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-navy/20 bg-white/50 px-6 py-16 text-center"
          data-testid="cohorts-empty"
        >
          <CalendarRange className="h-8 w-8 text-gold" />
          <p className="font-heading text-lg text-navy">No cohorts yet.</p>
          <p className="max-w-sm text-sm text-gray-500">
            {canCreate
              ? "Create your first cohort above, then build its schedule of lessons."
              : "An administrator hasn’t created any cohorts for this parish yet."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="cohorts-grid">
          {cohorts.map((c, i) => (
            <li
              key={c.id}
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              className="animate-[po-slide-up_280ms_ease-out]"
            >
              <Link
                href={`/ocia/cohorts/${c.id}`}
                data-testid={`cohort-card-${c.id}`}
                className="group flex h-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gold hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-heading text-lg text-navy group-hover:text-burgundy">{c.name}</h2>
                  <CalendarRange className="h-5 w-5 shrink-0 text-gold" />
                </div>
                {c.discussionDay ? (
                  <p className="text-sm text-gray-600">
                    {c.discussionDay}
                    {c.discussionTime ? ` · ${c.discussionTime}` : ""}
                  </p>
                ) : (
                  <p className="text-sm italic text-gray-400">No meeting day set</p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-4 w-4" /> {c.studentCount} {c.studentCount === 1 ? "student" : "students"}
                  </span>
                  <span>
                    {c.lessonCount} {c.lessonCount === 1 ? "lesson" : "lessons"}
                  </span>
                  {c.nextDiscussion ? (
                    <span className="ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-dark">
                      Next: {formatCalendarDate(c.nextDiscussion, { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
