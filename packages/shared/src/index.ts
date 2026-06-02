// Framework-agnostic types shared across the monorepo. No React, no Next.

/**
 * Per-parish roles (Architecture §8), OCIA vocabulary. `catechumen_candidate`
 * is one combined learner role. Roles are scoped to a parish, not global.
 */
export type Role = "super_admin" | "admin" | "catechist" | "catechumen_candidate" | "parish_member" | "studio";

/** Roles a super-admin may mimic via "view as" (never super-admin itself). */
export const IMPERSONATABLE_ROLES: Role[] = ["admin", "catechist", "catechumen_candidate", "studio", "parish_member"];

/** Human display labels for roles. */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Diocese Admin",
  admin: "Parish Admin",
  catechist: "Catechist",
  catechumen_candidate: "Catechumen/Candidate",
  parish_member: "Parish Member",
  studio: "Studio",
};

// Sacred-text display capitalization (used server + client). Ordered [pattern,
// replacement]; multi-word phrases BEFORE singles so "Holy Spirit" is fixed first.
const SACRED_TEXT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bholy spirit\b/gi, "Holy Spirit"],
  [/\bblessed virgin mary\b/gi, "Blessed Virgin Mary"],
  [/\bblessed sacrament\b/gi, "Blessed Sacrament"],
  [/\bnew testament\b/gi, "New Testament"],
  [/\bold testament\b/gi, "Old Testament"],
  [/\bgod\b/gi, "God"],
  [/\bjesus\b/gi, "Jesus"],
  [/\bchrist\b/gi, "Christ"],
  [/\blord\b/gi, "Lord"],
  [/\bmessiah\b/gi, "Messiah"],
  [/\btrinity\b/gi, "Trinity"],
  [/\bfather\b/gi, "Father"],
  [/\bson\b/gi, "Son"],
  [/\bspirit\b/gi, "Spirit"],
  [/\bmary\b/gi, "Mary"],
  [/\beucharist\b/gi, "Eucharist"],
  [/\bmass\b/gi, "Mass"],
  [/\bscripture\b/gi, "Scripture"],
  [/\bgospel\b/gi, "Gospel"],
  [/\bchurch\b/gi, "Church"],
];

/** Force-capitalize divine names / sacred terms for display. Framework-agnostic. */
export function normalizeSacredText(text: string): string {
  let out = text;
  for (const [re, repl] of SACRED_TEXT) out = out.replace(re, repl);
  return out;
}

// ─── Form-input string normalization (used by core data-access modules) ───────

/** Trim a maybe-absent string; empty or whitespace-only collapses to `null`
 *  (so optional fields persist as SQL NULL rather than an empty string). */
export const orNull = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);

/** Trim a maybe-absent string to a (possibly empty) string — never null/undefined. */
export const trimOrEmpty = (s?: string | null): string => (s ?? "").trim();

/**
 * Brand tokens resolved per request. The cascade is
 * default Parvus Ordo -> diocese -> parish (most specific wins).
 * See the branding requirement: per-parish AND per-diocese theming.
 */
export interface BrandTokens {
  /** Display name shown in the UI (e.g. "Parvus Ordo", "St. Mary Parish"). */
  name: string;
  /** Public path to the logo asset. */
  logoSrc: string;
  /** Short tagline / mission line. */
  tagline: string;
  colors: {
    burgundy: string;
    gold: string;
    navy: string;
    cream: string;
    parchment: string;
    rose: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

/**
 * Silent-reading speed (words/minute) for estimating how long a reading item takes a
 * learner. Intentionally higher than youth-teaches' spoken-delivery rate (WORDS_PER_MINUTE
 * = 150): a learner reads silently faster than a teen speaks a script aloud.
 */
const READING_WPM = 200;

/**
 * Estimate a lesson's duration (seconds) from its items. Pure (lives in shared so
 * the client builder can use it without pulling the DB layer). Heuristics ported
 * from Narthex: video = clip length; reading = words / READING_WPM; question = 60s.
 */
export function estimateItemsDurationSec(items: Array<{ kind: string; content: Record<string, unknown> }>): number {
  let sec = 0;
  for (const it of items) {
    if (it.kind === "video") {
      const start = Number(it.content.start_ms ?? 0);
      const end = it.content.end_ms == null ? null : Number(it.content.end_ms);
      if (end != null && end > start) sec += (end - start) / 1000;
    } else if (it.kind === "reading") {
      const text = String(it.content.html ?? "")
        .replace(/<[^>]*>/g, " ")
        .trim();
      const words = text ? text.split(/\s+/).length : 0;
      sec += (words / READING_WPM) * 60;
    } else if (it.kind === "question") {
      sec += 60;
    }
  }
  return sec;
}

/** Estimated lesson duration rounded up to whole minutes. */
export function estimateItemsDurationMin(items: Array<{ kind: string; content: Record<string, unknown> }>): number {
  return Math.ceil(estimateItemsDurationSec(items) / 60);
}

// ─── Video clip seek-enforcement (pure; the player applies these to <video>) ──

export interface ClipState {
  /** Absolute player time (seconds). */
  currentTime: number;
  /** Window start/end (seconds); endSec is Infinity for open-ended. */
  startSec: number;
  endSec: number;
  /** Furthest RELATIVE seconds reached, and whether the clip is finished. */
  maxReached: number;
  watched: boolean;
}

/**
 * Decision for each `timeupdate` tick. Enforces no-skip-ahead and the window end —
 * but DELIBERATELY does NOT clamp to the window start here. Clamping to start on
 * every tick fights hls.js while it buffers toward a non-zero start, which stalls
 * playback (regression guarded by the unit tests). Start is enforced on seek only.
 */
export function clipTimeUpdate(s: ClipState): { clampTo?: number; atEnd?: boolean } {
  const rel = s.currentTime - s.startSec;
  if (!s.watched && rel > s.maxReached + 2) return { clampTo: s.startSec + s.maxReached };
  if (s.endSec !== Infinity && s.currentTime >= s.endSec) return { atEnd: true };
  return {};
}

/** Decision for a manual seek: keep the user inside the window. */
export function clipSeek(s: ClipState): { clampTo?: number } {
  if (s.currentTime < s.startSec - 0.5) return { clampTo: s.startSec };
  if (!s.watched) {
    const rel = s.currentTime - s.startSec;
    if (rel > s.maxReached + 2) return { clampTo: s.startSec + s.maxReached };
  }
  return {};
}

/**
 * Clip-relative seconds for the furthest point a learner has watched, restored from
 * persisted progress (max_reached_ms) on (re)load. The player seeds BOTH the resume
 * position AND the seek-enforcement ceiling (`ClipState.maxReached`) from this single
 * value, so a learner's earned navigation survives a reload. Seeding the ceiling at 0
 * is the legacy "enforcement resets on reload" bug — so absent or forged (negative,
 * non-finite) progress floors to 0 rather than corrupting the window.
 */
export function clipResumeSeconds(maxReachedMs: number): number {
  return Number.isFinite(maxReachedMs) && maxReachedMs > 0 ? maxReachedMs / 1000 : 0;
}
