// Weekly Export (Narthex `weekly-export.md` port).
//
// For a cohort + week, walk every learning path in the cohort, find the lesson
// assigned to that path for that week, and gather: the lesson's reading material
// (HTML-stripped), its questions + the answers submitted by that path's members,
// and the student-submitted questions/feedback for that lesson (path-filtered).
// The result is a structured `WeeklyExport` (NOT a pre-rendered string), which
// `renderWeeklyExportMarkdown` turns into the copy-to-clipboard Markdown blob.
//
// Boundary (CLAUDE.md §5): this is a pure read. The RSC page calls
// `buildWeeklyExport` directly and gates the route to catechist/admin/super_admin
// (mirroring the student-responses inbox — see ocia/feedback.ts). Parish isolation
// is enforced by RLS via getDb(parishId); role is gated at the boundary because
// these parish-isolated tables carry no role in the RLS context. Any future
// /api/v1 export endpoint MUST reproduce that catechist/admin gate.
//
// Port decisions (see docs/narthex/DELTAS.md → weekly-export):
//  • Versioning: each lesson resolves to its LIVE version (lessons.live_version_id)
//    for material + questions; answers are matched to that live version's question
//    items. A lesson with no live version (offline) is skipped like a missing one.
//    (Narthex assumed "latest"; this is the versioned equivalent.)
//  • Template: lesson_versions.discussion_template is honored only when the week
//    resolves to a single distinct lesson across all paths (otherwise the export
//    spans multiple lessons and the system default — which says to weave themes —
//    is used). Parvus Ordo has no parish-level template column.
//  • Video items are deliberately excluded from the export (Narthex parity).

import { getDb } from "../db/client";
import { resolveDiscussionTemplate } from "./discussion-template";

const UNKNOWN_STUDENT = "Unknown";

export interface ExportAnswer {
  studentName: string;
  text: string;
}

export interface ExportQuestion {
  prompt: string;
  answers: ExportAnswer[];
}

export interface ExportMessage {
  studentName: string;
  text: string;
}

export interface PathWeekData {
  pathId: string;
  pathName: string;
  lessonId: string;
  lessonTitle: string;
  lessonDescription: string | null;
  /** Reading blocks, HTML-stripped to plain text (video blocks excluded). */
  readingBlocks: string[];
  questions: ExportQuestion[];
  studentQuestions: ExportMessage[];
  studentFeedback: ExportMessage[];
  /** Count of path-member answers across this path's questions. */
  answerCount: number;
}

export interface WeeklyExport {
  cohortId: string;
  cohortName: string;
  week: number;
  /** The resolved discussion-guide prompt prepended to the Markdown. */
  template: string;
  /** One per path that has a (live) lesson assigned for the week, in path order. */
  paths: PathWeekData[];
  /** Sum of answerCount across all paths — the header total. */
  totalAnswers: number;
}

// ── Pure helpers (unit-tested; no DB) ────────────────────────────────────────

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;/gi, "'"],
  [/&apos;/gi, "'"],
];

/**
 * Strip a reading block's rich-text HTML to readable plain text. Block-level tags
 * become line breaks and list items become "- " bullets, so paragraphs/lists stay
 * legible (an improvement over Narthex's tag→'' regex, which glued words). Common
 * named entities are decoded. e.g. `<p>Hi</p>` → `Hi`.
 */
export function htmlToPlainText(html: string): string {
  let out = String(html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/(p|div|h[1-6]|li|ul|ol|blockquote|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  for (const [re, repl] of ENTITIES) out = out.replace(re, repl);
  return out
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type RawPath = { path_id: string; name: string };
type RawWeekLesson = {
  path_id: string;
  lesson_id: string;
  version_id: string;
  title: string;
  description: string | null;
  discussion_template: string | null;
};
type RawItem = {
  version_id: string;
  id: string;
  position: number;
  kind: "reading" | "question";
  content: Record<string, unknown>;
};
type RawMember = { path_id: string; student_id: string };
type RawAnswer = { item_id: string; student_id: string; text: string; display_name: string | null };
type RawMessage = { lesson_id: string; student_id: string; text: string; display_name: string | null };

export interface AssembleInput {
  cohortId: string;
  cohortName: string;
  week: number;
  /** Learning paths in the cohort, already in display order. */
  paths: RawPath[];
  /** Live-lesson assignment for the week, one row per path that has one. */
  weekLessons: RawWeekLesson[];
  /** reading + question items for the resolved live versions. */
  items: RawItem[];
  members: RawMember[];
  answers: RawAnswer[];
  studentQuestions: RawMessage[];
  studentFeedback: RawMessage[];
}

/**
 * Pure assembly of the structured export from raw rows. Filters answers and
 * student questions/feedback to each path's own members, maps answers onto the
 * live version's questions, and resolves the discussion template. Separated from
 * the DB so the path-filtering / multi-path logic is unit-testable.
 */
export function assembleWeeklyExport(input: AssembleInput): WeeklyExport {
  const itemsByVersion = new Map<string, RawItem[]>();
  for (const it of input.items) {
    const list = itemsByVersion.get(it.version_id) ?? [];
    list.push(it);
    itemsByVersion.set(it.version_id, list);
  }
  // Path → set of member student ids.
  const membersByPath = new Map<string, Set<string>>();
  for (const m of input.members) {
    const set = membersByPath.get(m.path_id) ?? new Set<string>();
    set.add(m.student_id);
    membersByPath.set(m.path_id, set);
  }
  // item_id → answers; lesson_id → student questions/feedback.
  const answersByItem = new Map<string, RawAnswer[]>();
  for (const a of input.answers) {
    const list = answersByItem.get(a.item_id) ?? [];
    list.push(a);
    answersByItem.set(a.item_id, list);
  }
  const groupByLesson = (rows: RawMessage[]) => {
    const map = new Map<string, RawMessage[]>();
    for (const r of rows) {
      const list = map.get(r.lesson_id) ?? [];
      list.push(r);
      map.set(r.lesson_id, list);
    }
    return map;
  };
  const sqByLesson = groupByLesson(input.studentQuestions);
  const sfByLesson = groupByLesson(input.studentFeedback);

  const weekLessonByPath = new Map(input.weekLessons.map((w) => [w.path_id, w]));
  const name = (n: string | null) => (n && n.trim().length > 0 ? n : UNKNOWN_STUDENT);
  const byName = (a: ExportMessage, b: ExportMessage) =>
    a.studentName.localeCompare(b.studentName) || a.text.localeCompare(b.text);

  const paths: PathWeekData[] = [];
  for (const p of input.paths) {
    const wl = weekLessonByPath.get(p.path_id);
    if (!wl) continue; // no (live) lesson assigned to this path for the week → skip
    const memberIds = membersByPath.get(p.path_id) ?? new Set<string>();
    const versionItems = (itemsByVersion.get(wl.version_id) ?? []).slice().sort((a, b) => a.position - b.position);

    const readingBlocks: string[] = [];
    const questions: ExportQuestion[] = [];
    let answerCount = 0;
    for (const it of versionItems) {
      if (it.kind === "reading") {
        const text = htmlToPlainText(String(it.content.html ?? ""));
        if (text) readingBlocks.push(text);
      } else if (it.kind === "question") {
        const answers = (answersByItem.get(it.id) ?? [])
          .filter((a) => memberIds.has(a.student_id))
          .map((a) => ({ studentName: name(a.display_name), text: a.text }))
          .sort(byName);
        answerCount += answers.length;
        questions.push({ prompt: String(it.content.prompt ?? ""), answers });
      }
    }

    const pickMessages = (map: Map<string, RawMessage[]>): ExportMessage[] =>
      (map.get(wl.lesson_id) ?? [])
        .filter((m) => memberIds.has(m.student_id))
        .map((m) => ({ studentName: name(m.display_name), text: m.text }))
        .sort(byName);

    paths.push({
      pathId: p.path_id,
      pathName: p.name,
      lessonId: wl.lesson_id,
      lessonTitle: wl.title,
      lessonDescription: wl.description,
      readingBlocks,
      questions,
      studentQuestions: pickMessages(sqByLesson),
      studentFeedback: pickMessages(sfByLesson),
      answerCount,
    });
  }

  // Honor a lesson-level template only when the week is a single distinct lesson.
  const distinctLessons = new Set(paths.map((p) => p.lessonId));
  const lessonTemplate =
    distinctLessons.size === 1 ? (weekLessonByPath.get(paths[0]!.pathId)?.discussion_template ?? null) : null;

  return {
    cohortId: input.cohortId,
    cohortName: input.cohortName,
    week: input.week,
    template: resolveDiscussionTemplate(lessonTemplate, null),
    paths,
    totalAnswers: paths.reduce((sum, p) => sum + p.answerCount, 0),
  };
}

/**
 * Render the structured export as the Markdown blob the teacher copies. Order:
 * template → `---` → `# Week N Discussion — {cohort}` → optional multi-path note
 * → per path (optional `## Path:` heading when >1 path) → `### {title}` →
 * description → Lesson Material → Questions & Student Answers → optional Student
 * Questions / Student Feedback. Pure (unit-tested).
 */
export function renderWeeklyExportMarkdown(data: WeeklyExport): string {
  const multiPath = data.paths.length > 1;
  const out: string[] = [data.template, "---", `# Week ${data.week} Discussion — ${data.cohortName}`];

  if (multiPath) {
    out.push(
      `> This week spans ${data.paths.length} learning paths. Weave their themes together into one cohesive discussion.`,
    );
  }

  for (const p of data.paths) {
    if (multiPath) out.push(`## Path: ${p.pathName}`);
    out.push(`### ${p.lessonTitle}`);
    if (p.lessonDescription && p.lessonDescription.trim().length > 0) out.push(p.lessonDescription);

    out.push("#### Lesson Material");
    out.push(p.readingBlocks.length > 0 ? p.readingBlocks.join("\n\n") : "*No reading material.*");

    out.push("#### Questions & Student Answers");
    if (p.questions.length === 0) {
      out.push("*No questions in this lesson.*");
    } else {
      for (const q of p.questions) {
        const block = [`**Q: ${q.prompt}**`];
        if (q.answers.length === 0) block.push("*No answers submitted.*");
        else for (const a of q.answers) block.push(`- ${a.studentName}: ${a.text}`);
        out.push(block.join("\n"));
      }
    }

    if (p.studentQuestions.length > 0) {
      out.push("#### Student Questions");
      out.push(p.studentQuestions.map((m) => `- ${m.text} — ${m.studentName}`).join("\n"));
    }
    if (p.studentFeedback.length > 0) {
      out.push("#### Student Feedback");
      out.push(p.studentFeedback.map((m) => `- ${m.text} — ${m.studentName}`).join("\n"));
    }
  }

  return out.join("\n\n");
}

// ── DB read (integration-tested; RLS-scoped) ─────────────────────────────────

/**
 * Build the structured Weekly Export for a cohort + week. Parish-scoped by RLS:
 * a cohort the caller's parish cannot read yields an empty export (no crash),
 * matching the page's empty state. The caller (RSC page) MUST already have gated
 * the route to catechist/admin/super_admin.
 */
export async function buildWeeklyExport(
  parishId: string,
  opts: { cohortId: string; week: number },
): Promise<WeeklyExport> {
  const { cohortId, week } = opts;
  const empty = (cohortName = ""): WeeklyExport => ({
    cohortId,
    cohortName,
    week,
    template: resolveDiscussionTemplate(null, null),
    paths: [],
    totalAnswers: 0,
  });

  // A non-finite week (e.g. a non-numeric URL segment) can never match an int
  // week_number; short-circuit rather than send NaN to Postgres.
  if (!Number.isInteger(week)) return empty();

  const db = getDb(parishId);

  const { rows: cohortRows } = await db.query<{ id: string; name: string }>(
    "SELECT id, name FROM cohorts WHERE id = $1",
    [cohortId],
  );
  const cohort = cohortRows[0];
  if (!cohort) return empty(); // not found / RLS-blocked → empty state

  const { rows: paths } = await db.query<RawPath>(
    "SELECT id AS path_id, name FROM learning_paths WHERE cohort_id = $1 ORDER BY created_at, name, id",
    [cohortId],
  );
  if (paths.length === 0) return empty(cohort.name);
  const pathIds = paths.map((p) => p.path_id);

  // Path → this week's lesson, resolved to the lesson's LIVE version (offline
  // lessons — no live_version_id — are skipped via the inner join).
  const { rows: weekLessons } = await db.query<RawWeekLesson>(
    `SELECT lpl.path_id, lpl.lesson_id, lv.id AS version_id, lv.title, lv.description, lv.discussion_template
       FROM learning_path_lessons lpl
       JOIN lessons l ON l.id = lpl.lesson_id
       JOIN lesson_versions lv ON lv.id = l.live_version_id
      WHERE lpl.path_id = ANY($1::uuid[]) AND lpl.week_number = $2`,
    [pathIds, week],
  );
  if (weekLessons.length === 0) return empty(cohort.name);

  const versionIds = [...new Set(weekLessons.map((w) => w.version_id))];
  const lessonIds = [...new Set(weekLessons.map((w) => w.lesson_id))];

  // reading + question items for the resolved live versions (video excluded).
  const { rows: items } = await db.query<RawItem>(
    `SELECT version_id, id, position, kind, content
       FROM lesson_items
      WHERE version_id = ANY($1::uuid[]) AND kind IN ('reading', 'question')
      ORDER BY version_id, position`,
    [versionIds],
  );
  const questionItemIds = items.filter((i) => i.kind === "question").map((i) => i.id);

  const { rows: members } = await db.query<RawMember>(
    "SELECT path_id, student_id FROM learning_path_members WHERE path_id = ANY($1::uuid[])",
    [pathIds],
  );

  const answers =
    questionItemIds.length === 0
      ? []
      : (
          await db.query<RawAnswer>(
            `SELECT a.item_id, a.student_id, a.text, u.display_name
               FROM answers a JOIN users u ON u.id = a.student_id
              WHERE a.item_id = ANY($1::uuid[])`,
            [questionItemIds],
          )
        ).rows;

  const messagesFor = async (table: "student_questions" | "student_feedback") =>
    (
      await db.query<RawMessage>(
        `SELECT m.lesson_id, m.student_id, m.text, u.display_name
           FROM ${table} m JOIN users u ON u.id = m.student_id
          WHERE m.lesson_id = ANY($1::uuid[])
          ORDER BY m.created_at`,
        [lessonIds],
      )
    ).rows;
  const [studentQuestions, studentFeedback] = await Promise.all([
    messagesFor("student_questions"),
    messagesFor("student_feedback"),
  ]);

  return assembleWeeklyExport({
    cohortId,
    cohortName: cohort.name,
    week,
    paths,
    weekLessons,
    items,
    members,
    answers,
    studentQuestions,
    studentFeedback,
  });
}
