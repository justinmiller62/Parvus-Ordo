// Discussion-guide prompt template resolution (Narthex weekly-export port).
//
// Pure + framework-agnostic: the Weekly Export prepends one of these templates to
// the assembled lesson material + student responses, and the teacher pastes the
// whole blob into an external LLM to generate a 30-minute discussion guide.
//
// Cascade (faithful to Narthex `shared/discussion-template.ts`):
//   lesson template (if non-blank) → parish template (if non-blank) → system default.
// Whitespace-only strings count as blank. In Parvus Ordo the discussion template
// lives on `lesson_versions.discussion_template` (parishes have no such column),
// so the Weekly Export passes the lesson's template (only when the week resolves
// to a single lesson — see weekly-export.ts) and `null` for the parish slot.

/**
 * The fallback discussion-guide prompt when no lesson/parish template is set.
 * Authored for the port: instructs an LLM to turn the bundled material + the
 * students' own answers/questions/feedback into a 30-minute OCIA group plan.
 */
export const SYSTEM_DEFAULT_DISCUSSION_TEMPLATE = `You are an experienced Catholic catechist preparing a 30-minute small-group discussion for an OCIA cohort. Below this prompt is everything you need: the lesson material the group studied this week, the questions they answered (with their actual answers), and any questions or feedback they submitted.

Using ONLY the material and responses below, produce a warm, faithful discussion plan with these sections:

1. **Opening Prayer** — a short, fitting prayer to begin.
2. **Review (5 min)** — briefly recap the key points of the lesson material in plain language.
3. **Discussion Questions (12 min)** — 3–4 open questions grounded in the lesson and in what the students actually wrote. Quote or paraphrase their answers to draw connections and surface common themes or misunderstandings to gently correct.
4. **Their Questions (6 min)** — address the questions the students submitted; answer them clearly and faithfully to Catholic teaching (cite the Catechism where natural).
5. **Application (5 min)** — one concrete way to live this out in the coming week.
6. **Closing Prayer** — a brief prayer to send them out.

Keep the tone pastoral and encouraging. Meet the students where they are.`;

/**
 * Resolve the discussion template: the lesson's own template wins if non-blank,
 * else the parish template if non-blank, else the system default. Whitespace-only
 * values are treated as blank.
 */
export function resolveDiscussionTemplate(
  lessonTemplate: string | null | undefined,
  parishTemplate: string | null | undefined,
): string {
  if (lessonTemplate && lessonTemplate.trim().length > 0) return lessonTemplate;
  if (parishTemplate && parishTemplate.trim().length > 0) return parishTemplate;
  return SYSTEM_DEFAULT_DISCUSSION_TEMPLATE;
}
