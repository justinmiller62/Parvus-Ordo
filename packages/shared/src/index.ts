// Framework-agnostic types shared across the monorepo. No React, no Next.

/**
 * Per-parish roles (Architecture §8), OCIA vocabulary. `catechumen_candidate`
 * is one combined learner role. Roles are scoped to a parish, not global.
 */
export type Role = "super_admin" | "admin" | "catechist" | "catechumen_candidate" | "parish_member" | "studio";

/** Roles a super-admin may mimic via "view as" (never super-admin itself). */
export const IMPERSONATABLE_ROLES: Role[] = ["admin", "catechist", "catechumen_candidate", "studio", "parish_member"];

/**
 * Content-managing parish staff: diocese/parish admins + catechists. The "can they edit
 * dictionary/prayers, build OCIA lessons, manage media, review studio work?" set — one
 * rule consumed by Server Actions, route handlers, pages, and the app shell so the client
 * can never drift from the server guards. Studio creators, OCIA learners, and plain parish
 * members are NOT staff.
 */
export const STAFF_ROLES: Role[] = ["super_admin", "admin", "catechist"];
// A type guard (not just boolean) so a `if (!isStaff(role)) redirect()` guard narrows
// `role` to the staff subset afterward — the narrowing the inline disjunctions gave.
export function isStaff(role: Role | null | undefined): role is "super_admin" | "admin" | "catechist" {
  return role === "super_admin" || role === "admin" || role === "catechist";
}

/**
 * Parish/diocese administrators: the "can they manage members + roles, send invites,
 * change parish settings?" set — a strict subset of {@link STAFF_ROLES} (a catechist is
 * staff but NOT an admin). One rule for the Server Actions, pages, and app shell that
 * gate admin-only writes, so the client can never drift from the server guards.
 */
export const ADMIN_ROLES: Role[] = ["super_admin", "admin"];
// A type guard (like isStaff) so `if (!isAdmin(role)) redirect()` narrows `role` to the
// admin subset afterward.
export function isAdmin(role: Role | null | undefined): role is "super_admin" | "admin" {
  return role === "super_admin" || role === "admin";
}

/** Human display labels for roles. */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Diocese Admin",
  admin: "Parish Admin",
  catechist: "Catechist",
  catechumen_candidate: "Catechumen/Candidate",
  parish_member: "Parish Member",
  studio: "Studio",
};

// ─── Module → role eligibility ────────────────────────────────────────────────
// Defined once and consumed by BOTH the parish dashboard (which module launcher
// cards to render) and the app shell (which module nav links to show), so the two
// can never drift. The dashboard redirects single-module roles away before these
// run (catechist/learner → OCIA, studio → Parvus Studio), so the broader OCIA/
// Studio predicates resolve to "admins only" there while staying correct for the
// shell, which serves every role. This is also the single seam a future per-parish
// module-enable toggle should gate on.

/** OCIA: parish staff (admins, catechists) + OCIA learners. */
export function ociaEligible(role: Role | null): boolean {
  return role === "super_admin" || role === "admin" || role === "catechist" || role === "catechumen_candidate";
}

/** Parvus Studio (formerly "Youth Teaches"): studio creators + catechists + admins. */
export function studioEligible(role: Role | null): boolean {
  return role === "super_admin" || role === "admin" || role === "catechist" || role === "studio";
}

/** People (invite members, manage roles): parish + diocese admins only. */
export function peopleEligible(role: Role | null): boolean {
  return role === "super_admin" || role === "admin";
}

// ─── Module registry + per-parish enablement resolver (RFC-001) ───────────────
// One definition of "what modules exist, who may use each, and whether a parish may
// turn it off" — shared by the app shell (nav), the module entry-point guards, the
// core resolver, and the future systems-admin tool, so capability and enablement can
// never drift across them. `platform`/`branding`/`auth` are infra, not modules;
// `media` is an OCIA-internal asset library gated transitively by `ocia`, not a key.

export type ModuleKey = "ocia" | "people" | "studio" | "dictionary" | "prayers" | "onboarding";

export interface ModuleDef {
  key: ModuleKey;
  /** Human label (matches the nav launchers). */
  label: string;
  /** Roles that may use the module WHEN it is enabled — capability, not enablement. */
  roles: Role[];
  /** false = always-on platform capability a parish cannot disable (RFC-001 §3.1). */
  toggleable: boolean;
  /** Enablement when a parish has no explicit row. true for every module today, so
   *  introducing the toggle is a zero-behavior-change deploy (RFC-001 §3.6). */
  defaultEnabled: boolean;
}

// Locked override po-wisp-rrwul (supersedes RFC-001 §6.1): ONLY `ocia` and `studio`
// are toggleable; `people`, `dictionary`, `prayers`, `onboarding` are always-on
// platform capabilities a parish cannot disable. Per-module `roles` mirror the
// existing eligibility predicates where they exist (ocia↔ociaEligible,
// studio↔studioEligible, people↔peopleEligible); dictionary/prayers are usable by any
// parish role (their routes gate on parish, not role); onboarding (OCIA applications +
// invites) is a staff capability.
export const MODULES: Record<ModuleKey, ModuleDef> = {
  ocia: {
    key: "ocia",
    label: "OCIA",
    roles: ["super_admin", "admin", "catechist", "catechumen_candidate"],
    toggleable: true,
    defaultEnabled: true,
  },
  studio: {
    key: "studio",
    label: "Parvus Studio",
    roles: ["super_admin", "admin", "catechist", "studio"],
    toggleable: true,
    defaultEnabled: true,
  },
  people: {
    key: "people",
    label: "People",
    roles: ["super_admin", "admin"],
    toggleable: false,
    defaultEnabled: true,
  },
  dictionary: {
    key: "dictionary",
    label: "Dictionary",
    roles: ["super_admin", "admin", "catechist", "catechumen_candidate", "parish_member", "studio"],
    toggleable: false,
    defaultEnabled: true,
  },
  prayers: {
    key: "prayers",
    label: "Prayers",
    roles: ["super_admin", "admin", "catechist", "catechumen_candidate", "parish_member", "studio"],
    toggleable: false,
    defaultEnabled: true,
  },
  onboarding: {
    key: "onboarding",
    label: "Onboarding",
    roles: ["super_admin", "admin", "catechist"],
    toggleable: false,
    defaultEnabled: true,
  },
};

/**
 * Resolve which modules are enabled for a parish: a pure overlay of the parish's
 * `parish_modules` rows onto the registry defaults (RFC-001 §3.3). Sparse-row
 * semantics — a missing row means "use defaultEnabled" (§3.2). A non-toggleable
 * module is always pinned to its default (true): it cannot be disabled by a row
 * (§3.1), so the registry stays the source of truth even against a stray or legacy
 * row. Rows for unknown module keys are ignored. The layered shape
 * (`defaults ← parish rows`) is the seam a future diocese-cascade layer slots into
 * without changing this signature (§3.3).
 */
export function resolveEnabled(
  rows: ReadonlyArray<{ module_key: string; enabled: boolean }>,
  registry: Record<ModuleKey, ModuleDef> = MODULES,
): Set<ModuleKey> {
  const overrides = new Map<string, boolean>();
  for (const r of rows) overrides.set(r.module_key, r.enabled);
  const enabled = new Set<ModuleKey>();
  for (const key of Object.keys(registry) as ModuleKey[]) {
    const def = registry[key];
    // Always-on modules ignore rows; only a toggleable module honors a present row.
    const on = def.toggleable && overrides.has(key) ? overrides.get(key)! : def.defaultEnabled;
    if (on) enabled.add(key);
  }
  return enabled;
}

/**
 * Whether `role` may use module `key` in a parish: the module must be enabled AND the
 * role must be capable of it (RFC-001 §3.3). The single "is module M available to
 * viewer V in parish P" rule, consumed by nav generation and the module entry-point
 * guards so the client can never drift from the server gate.
 */
export function moduleAvailable(role: Role | null, key: ModuleKey, enabled: Set<ModuleKey>): boolean {
  return enabled.has(key) && !!role && MODULES[key].roles.includes(role);
}

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

// ─── Recording upload policy (pure; server route + iOS client both validate) ──

/** Max bytes for a Parvus Studio recording upload (~120MB, under the proxy's
 * 128MB buffer cap). Shared so the iOS client can pre-validate before sending. */
export const MAX_RECORDING_BYTES = 120 * 1024 * 1024;

/** A rejected recording upload: the HTTP status the API surfaces and why. */
export interface RecordingUploadRejection {
  status: number;
  message: string;
}

/**
 * Validate an uploaded recording's byte size against the shared limit. Returns
 * null when acceptable, or a rejection (status + message) to surface. Pure — no
 * DB, no framework — so every upload path enforces the same cap and message.
 */
export function validateRecordingUpload(sizeBytes: number): RecordingUploadRejection | null {
  if (sizeBytes > MAX_RECORDING_BYTES) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(0);
    return { status: 413, message: `recording too large (${mb} MB). Max ${MAX_RECORDING_BYTES / 1024 / 1024} MB.` };
  }
  return null;
}
