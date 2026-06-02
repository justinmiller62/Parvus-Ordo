"use client";

import { useState, useTransition } from "react";
import type { PathDetail, PublishedLessonRow } from "@parvaordo/core";
import { ChevronDown, Plus, Sparkles, Trash2 } from "lucide-react";
import { createPathAction, deletePathAction, setPathLessonsAction, togglePathMemberAction } from "./actions";

const input =
  "rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";

export function LearningPathsTab({
  cohortId,
  paths,
  allLessons,
}: {
  cohortId: string;
  paths: PathDetail[];
  allLessons: PublishedLessonRow[];
}) {
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      await createPathAction(cohortId, trimmed);
      setName("");
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Learning paths assign a sub-sequence of lessons to some of the cohort’s students — so different learners can
        follow different sets.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New path name (e.g. Adapted track)"
          data-testid="path-name"
          className={`flex-1 ${input}`}
        />
        <button
          type="button"
          onClick={create}
          disabled={pending || !name.trim()}
          data-testid="path-create"
          className="inline-flex items-center gap-1 rounded-md bg-burgundy px-3 py-2 text-sm font-medium text-cream transition hover:bg-rose disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add path
        </button>
      </div>

      {paths.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-navy/20 bg-white/50 px-6 py-12 text-center">
          <Sparkles className="h-7 w-7 text-gold" />
          <p className="font-heading text-navy">No learning paths yet</p>
          <p className="max-w-sm text-sm text-gray-500">
            Every student follows the full cohort schedule until you add one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="paths-list">
          {paths.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === p.id ? null : p.id)}
                  data-testid={`path-toggle-${p.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${openId === p.id ? "rotate-180" : ""}`}
                  />
                  <span className="truncate font-medium text-navy">{p.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {p.lessons.length} lessons · {p.members.filter((m) => m.inPath).length} students
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete the “${p.name}” path?`))
                      startTransition(() => deletePathAction(cohortId, p.id));
                  }}
                  className="text-gray-400 transition hover:text-rose"
                  title="Delete path"
                  aria-label="Delete path"
                  data-testid={`path-delete-${p.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {openId === p.id ? <PathDetailPanel cohortId={cohortId} path={p} allLessons={allLessons} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PathDetailPanel({
  cohortId,
  path,
  allLessons,
}: {
  cohortId: string;
  path: PathDetail;
  allLessons: PublishedLessonRow[];
}) {
  const [, startTransition] = useTransition();
  const [editingLessons, setEditingLessons] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(path.lessons.map((l) => l.lessonId)));

  function saveLessons() {
    startTransition(async () => {
      await setPathLessonsAction(cohortId, path.id, [...selected]);
      setEditingLessons(false);
    });
  }

  return (
    <div className="space-y-4 border-t border-gray-100 bg-parchment/40 p-3">
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Lessons</h3>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set(path.lessons.map((l) => l.lessonId)));
              setEditingLessons((v) => !v);
            }}
            data-testid={`path-edit-lessons-${path.id}`}
            className="text-xs font-medium text-burgundy hover:underline"
          >
            {editingLessons ? "Cancel" : "Edit lessons"}
          </button>
        </div>

        {editingLessons ? (
          <div className="space-y-2">
            <ul className="max-h-56 space-y-1 overflow-auto rounded-md border border-gray-200 bg-white p-2">
              {allLessons.map((l) => (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-navy hover:bg-parchment">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(l.id);
                          else next.delete(l.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-navy/30 text-burgundy"
                    />
                    <span className="truncate">{l.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-gray-400">{l.scope}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={saveLessons}
              data-testid={`path-save-lessons-${path.id}`}
              className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream transition hover:bg-rose"
            >
              Save lessons
            </button>
          </div>
        ) : path.lessons.length === 0 ? (
          <p className="text-sm text-gray-400">No lessons assigned — these students see the full cohort schedule.</p>
        ) : (
          <ol className="space-y-1">
            {path.lessons.map((l) => (
              <li key={l.lessonId} className="flex items-center gap-2 text-sm text-navy">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-burgundy/10 text-[11px] font-semibold text-burgundy">
                  {l.weekNumber}
                </span>
                <span className="truncate">{l.title}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Students</h3>
        {path.members.length === 0 ? (
          <p className="text-sm text-gray-400">No students in this cohort yet.</p>
        ) : (
          <ul className="space-y-1">
            {path.members.map((m) => (
              <li key={m.studentId}>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-navy">
                  <input
                    type="checkbox"
                    defaultChecked={m.inPath}
                    data-testid={`path-member-${path.id}-${m.studentId}`}
                    onChange={(e) =>
                      startTransition(() => togglePathMemberAction(cohortId, path.id, m.studentId, e.target.checked))
                    }
                    className="h-4 w-4 rounded border-navy/30 text-burgundy"
                  />
                  <span className="truncate">{m.displayName}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
