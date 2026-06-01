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
 * Estimate a lesson's duration (seconds) from its items. Pure (lives in shared so
 * the client builder can use it without pulling the DB layer). Heuristics ported
 * from Narthex: video = clip length; reading = words / 200 wpm; question = 60s.
 */
export function estimateItemsDurationSec(
  items: Array<{ kind: string; content: Record<string, unknown> }>,
): number {
  let sec = 0;
  for (const it of items) {
    if (it.kind === "video") {
      const start = Number(it.content.start_ms ?? 0);
      const end = it.content.end_ms == null ? null : Number(it.content.end_ms);
      if (end != null && end > start) sec += (end - start) / 1000;
    } else if (it.kind === "reading") {
      const text = String(it.content.html ?? "").replace(/<[^>]*>/g, " ").trim();
      const words = text ? text.split(/\s+/).length : 0;
      sec += (words / 200) * 60;
    } else if (it.kind === "question") {
      sec += 60;
    }
  }
  return sec;
}

/** Estimated lesson duration rounded up to whole minutes. */
export function estimateItemsDurationMin(
  items: Array<{ kind: string; content: Record<string, unknown> }>,
): number {
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
