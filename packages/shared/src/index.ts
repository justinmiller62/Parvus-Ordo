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

export type ModuleKey = "ocia" | "people" | "studio" | "dictionary" | "prayers" | "onboarding" | "gather";

export interface ModuleDef {
  key: ModuleKey;
  /** Human label (matches the nav launchers). */
  label: string;
  /** Roles that may use the module WHEN it is enabled — capability, not enablement. */
  roles: Role[];
  /** false = always-on platform capability a parish cannot disable (RFC-001 §3.1). */
  toggleable: boolean;
  /** Enablement when a parish has no explicit row. true for every pre-existing module, so
   *  introducing the toggle was a zero-behavior-change deploy (RFC-001 §3.6); `gather` is
   *  false — a net-new major module ships dark and is opt-in per parish (RFC-005 §2). */
  defaultEnabled: boolean;
}

// Locked override po-wisp-rrwul (supersedes RFC-001 §6.1): of the pre-existing modules
// ONLY `ocia` and `studio` are toggleable; `people`, `dictionary`, `prayers`, `onboarding`
// are always-on platform capabilities a parish cannot disable. RFC-005 §2 adds `gather` as
// a 3rd toggleable module, opt-in per parish (`defaultEnabled: false` — ships dark, each
// parish turns it on via the RFC-004 systems-admin toggle). Per-module `roles` mirror the
// existing eligibility predicates where they exist (ocia↔ociaEligible,
// studio↔studioEligible, people↔peopleEligible); dictionary/prayers are usable by any
// parish role (their routes gate on parish, not role); onboarding (OCIA applications +
// invites) is a staff capability; gather is parishioner-facing (every role).
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
  gather: {
    key: "gather",
    label: "Gather",
    // Parishioner-facing community module — every parish role may use it once enabled.
    roles: ["super_admin", "admin", "catechist", "catechumen_candidate", "parish_member", "studio"],
    toggleable: true,
    defaultEnabled: false, // ships dark; opt-in per parish via the RFC-004 systems-admin toggle (§2)
  },
};

/** A sparse module-enablement row, from parish_modules or diocese_modules. */
export interface ModuleRow {
  module_key: string;
  enabled: boolean;
}

/**
 * Resolve which modules are enabled for a parish: a pure 3-layer overlay of the registry
 * defaults with the diocese's then the parish's sparse rows — MOST-SPECIFIC WINS:
 *   defaults  ←  diocese_modules  ←  parish_modules
 * (RFC-001 §3.3). Sparse-row semantics — a missing row at a layer falls through to the next
 * (§3.2): a parish row overrides its diocese row, which overrides the registry default. A
 * non-toggleable module is always pinned to its default (true): it cannot be disabled by ANY
 * layer (§3.1), so the registry stays the source of truth even against a stray row. Rows for
 * unknown module keys are ignored. Passing only `parish` gives the original per-parish
 * behavior; the `diocese` layer is the cascade activated by RFC-004 D1.
 */
export function resolveEnabled(
  layers: { diocese?: ReadonlyArray<ModuleRow>; parish?: ReadonlyArray<ModuleRow> },
  registry: Record<ModuleKey, ModuleDef> = MODULES,
): Set<ModuleKey> {
  const parish = new Map<string, boolean>();
  for (const r of layers.parish ?? []) parish.set(r.module_key, r.enabled);
  const diocese = new Map<string, boolean>();
  for (const r of layers.diocese ?? []) diocese.set(r.module_key, r.enabled);

  const enabled = new Set<ModuleKey>();
  for (const key of Object.keys(registry) as ModuleKey[]) {
    const def = registry[key];
    let on: boolean;
    if (!def.toggleable) {
      on = def.defaultEnabled; // always-on: no layer can disable it
    } else if (parish.has(key)) {
      on = parish.get(key)!; // most specific — parish overrides everything below
    } else if (diocese.has(key)) {
      on = diocese.get(key)!; // cascades to the parish unless a parish row overrides
    } else {
      on = def.defaultEnabled;
    }
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

// ─── Video trim-window math (pure; the editor side that AUTHORS the clip window) ─
//
// Both trimmers project a dragged [start, end] selection onto the lesson item's
// { start_ms, end_ms } the seek-enforcing players above then enforce. The Bunny
// trimmer scrubs a <video>; the YouTube trimmer scrubs the IFrame Player API — but
// the window math is identical and lives here so it's shared + unit-tested (the
// YouTube IFrame trimmer can't be exercised offline in e2e, so this IS its safety
// net). An out-point that reaches the end stores end_ms as null (= full video).

/** Minimum selectable gap between the in- and out-points (seconds). */
export const TRIM_MIN_GAP_SEC = 0.5;
/** How close to the duration the out-point counts as "the end" → store end_ms null. */
export const TRIM_FULL_EPSILON_SEC = 0.05;

/** Clamp a proposed in-point to [0, endSec − min gap]. */
export function clampTrimStart(value: number, endSec: number, minGap = TRIM_MIN_GAP_SEC): number {
  return Math.max(0, Math.min(value, endSec - minGap));
}

/**
 * Clamp a proposed out-point to [startSec + min gap, duration]. When the duration
 * isn't known yet (0), fall back to the requested value bounded only by the in-point
 * gap — the live media will re-clamp once it reports its length.
 */
export function clampTrimEnd(value: number, startSec: number, duration: number, minGap = TRIM_MIN_GAP_SEC): number {
  const hi = duration > 0 ? duration : value;
  return Math.max(startSec + minGap, Math.min(value, hi));
}

/** Whether the out-point reaches the end (→ store end_ms as null = full video). */
export function isFullTrimWindow(endSec: number, duration: number, epsilon = TRIM_FULL_EPSILON_SEC): boolean {
  return duration > 0 && endSec >= duration - epsilon;
}

/** Project a [startSec, endSec] selection onto the lesson-item content fields (ms). */
export function trimWindowToMs(
  startSec: number,
  endSec: number,
  duration: number,
): { start_ms: number; end_ms: number | null } {
  return {
    start_ms: Math.round(startSec * 1000),
    end_ms: isFullTrimWindow(endSec, duration) ? null : Math.round(endSec * 1000),
  };
}

/** Format seconds as m:ss for trim labels; clamps negative / non-finite to 0:00. */
export function formatTimecode(totalSeconds: number): string {
  let sec = totalSeconds;
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const whole = Math.floor(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// ─── Server-side video-watch completion gate (pure) ───────────────────────────
//
// COMPLETION (not seek-enforcement) is what moved server-side: a video lesson item may
// be completed only once the student's persisted furthest-reached point comes close
// enough to the clip end. Seek-enforcement (clipSeek/clipTimeUpdate) stays client-side
// per Architecture §9. This gate is best-effort against tampering — the furthest point
// is reported by the player and trusted, so a forged report at the clip end still
// satisfies it (residual tracked in po-4dyo) — but it does close the trivial forges: a
// direct advanceAction POST or a saveVideoProgress with no/too-little progress can no
// longer mark an unwatched video done.

/**
 * How close to the clip end the furthest-reached point must come to count as "watched"
 * (ms). Mirrors the player, which flips its cosmetic `watched` state and seeds the
 * completion save once within this window of the end, so a learner who reaches the
 * unlock point is never wrongly rejected by the server.
 */
export const VIDEO_WATCH_TOLERANCE_MS = 5_000;

/**
 * Floor for clips at or under the tolerance window: a clip that short would have a
 * `duration - tolerance` threshold of <= 0 and wave through zero watching, so it must
 * instead reach this fraction of its length. Only the sub-tolerance regime uses it —
 * clips longer than the tolerance keep the flat 5s end-grace, so this never makes a
 * longer clip stricter (which would risk a silent lockout when the throttled progress
 * save lands just inside the grace band).
 */
export const VIDEO_WATCH_MIN_FRACTION = 0.9;

/**
 * The furthest-reached point (ms) at which a video clip counts as watched. For a clip
 * longer than the tolerance it's `duration - tolerance` (within 5s of the end); for a
 * clip at or under the tolerance it's `duration * fraction` (the floor). Returns
 * Infinity for an unknown / non-positive / non-finite length so nothing satisfies it.
 */
export function videoWatchThresholdMs(clipDurationMs: number): number {
  if (!Number.isFinite(clipDurationMs) || clipDurationMs <= 0) return Infinity;
  return clipDurationMs > VIDEO_WATCH_TOLERANCE_MS
    ? clipDurationMs - VIDEO_WATCH_TOLERANCE_MS
    : clipDurationMs * VIDEO_WATCH_MIN_FRACTION;
}

/**
 * Authoritative gate behind the player's cosmetic `watched` button: true once the
 * persisted furthest-reached point reaches `videoWatchThresholdMs`. No, partial, or
 * non-finite/negative progress fails; an unknown or non-positive clip length fails
 * closed (authoring always supplies a window or a probed source duration).
 */
export function videoWatchSatisfied(maxReachedMs: number, clipDurationMs: number | null): boolean {
  if (clipDurationMs == null || clipDurationMs <= 0) return false;
  if (!Number.isFinite(maxReachedMs) || maxReachedMs <= 0) return false;
  return maxReachedMs >= videoWatchThresholdMs(clipDurationMs);
}

// ─── Wall-clock pacing of the furthest-reached point (po-4dyo) ────────────────
//
// `videoWatchSatisfied` decides completion from the persisted furthest point, but that
// point is reported by the player. The residual the gate left open: a client could POST a
// single saveVideoProgress with the furthest point AT the clip end and self-complete
// without watching. `pacedMaxReachedMs` closes it server-side — it bounds how far the
// stored point may advance in one save to the REAL wall-clock elapsed since the previous
// save (times the max believable playback rate). Reaching the clip end therefore costs
// roughly a clip-length of real elapsed time, so a one-shot forge no longer works.

/**
 * How much new ground (ms) the player batches before persisting watch progress. The
 * client throttles its progress saves to this cadence; the server's first-save budget is
 * sized against it so a real watcher's opening save is never paced away.
 */
export const VIDEO_PROGRESS_SAVE_INTERVAL_MS = 10_000;

/**
 * Ceiling on believable playback speed used to pace the furthest-reached point against
 * wall-clock. Native `<video>` controls allow up to 2×; the extra 0.5 margin absorbs
 * network/clock jitter on the completion-deciding save so a genuine watcher at any normal
 * speed is never throttled, while a forge to the clip end still costs ~clip-length / this
 * of real elapsed time.
 */
export const VIDEO_WATCH_MAX_RATE = 2.5;

/**
 * Budget (ms) for the FIRST progress save of an item, when there is no prior timestamp to
 * pace against. Sized just over one save interval so a real watcher's opening save (the
 * first ~interval-of-ground throttle save, or a short clip's single completion save)
 * always lands, while a single forged save still can't jump a longer clip to its end —
 * that now needs further saves spaced over real time.
 */
export const VIDEO_WATCH_FIRST_SAVE_BUDGET_MS = VIDEO_PROGRESS_SAVE_INTERVAL_MS + 2_000;

/**
 * Wall-clock pacing of the furthest-reached point. Bounds how far the stored point may
 * advance in a single save to the real time elapsed since the previous save (times the max
 * believable playback rate), so a client can't forge one save to the clip end and
 * self-complete (po-4dyo). Pure + deterministic — the caller passes wall-clock in — so it
 * unit-tests without a real clock. The caller still clamps the result to the clip length.
 *
 * @param prevMaxMs     furthest point already stored (treated as 0 if missing/invalid)
 * @param reportedMs    the client's (shape-validated) furthest-reached report
 * @param wallElapsedMs real ms since the previous save, or `null` for the first save of an
 *                      item (no prior timestamp — the fixed first-save budget applies).
 *                      A non-positive/non-finite measured elapsed grants no advance.
 * @returns the furthest point to store: never below `prevMaxMs`, never beyond what real
 *          elapsed time allows.
 */
export function pacedMaxReachedMs(prevMaxMs: number, reportedMs: number, wallElapsedMs: number | null): number {
  const prev = Number.isFinite(prevMaxMs) && prevMaxMs > 0 ? prevMaxMs : 0;
  const reported = Number.isFinite(reportedMs) && reportedMs > 0 ? reportedMs : 0;
  if (reported <= prev) return prev; // the point only ever grows
  let budget: number;
  if (wallElapsedMs == null) {
    // First save for this item: no prior timestamp, so the one fixed budget applies.
    budget = VIDEO_WATCH_FIRST_SAVE_BUDGET_MS;
  } else if (!Number.isFinite(wallElapsedMs) || wallElapsedMs <= 0) {
    // A rapid second save (or clock skew) gives no real elapsed time → no advance. This is
    // what defeats a walk-up: spamming saves can't climb to the end without real time.
    budget = 0;
  } else {
    budget = wallElapsedMs * VIDEO_WATCH_MAX_RATE;
  }
  return Math.min(reported, prev + budget);
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

// ─── Systems-admin: parish slug, lifecycle status, branding (RFC-004) ─────────

// Labels reserved at the apex (never a parish slug). Mirrors RESERVED_LABELS in the core
// hostname resolver (packages/core/src/platform/hostname.ts) — keep the two aligned; those
// labels always resolve to the apex, so a parish can never own them as a subdomain.
const RESERVED_SLUGS = new Set(["www", "app"]);
// Lowercase alphanumeric segments joined by single hyphens — no leading/trailing/double
// hyphen (so "holyspirit-austin" is valid; "-x", "x-", "a--b", "Holy" are not).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 63; // DNS label limit (the slug is also a subdomain label)

/**
 * Validate a parish slug's SHAPE (RFC-004 §6.1): lowercase a–z/0–9 in hyphen-joined
 * segments, {@link SLUG_MIN}–{@link SLUG_MAX} chars, and not a reserved label. The slug
 * is both the parish subdomain and part of its globally-unique slug-city identity (e.g.
 * "holyspirit-austin"); global UNIQUENESS is enforced at the write layer, this checks
 * format only. Pure — used by core provisioning AND the admin UI so both reject the same.
 */
export function isValidSlug(slug: string): boolean {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return false;
  if (!SLUG_RE.test(slug)) return false;
  return !RESERVED_SLUGS.has(slug);
}

/** Parish lifecycle states (RFC-004 §8): provisioned `pending_setup` → `active` on setup
 *  completion, `suspended`/reactivated thereafter. */
export const PARISH_STATUSES = ["pending_setup", "active", "suspended"] as const;
export type ParishStatus = (typeof PARISH_STATUSES)[number];

// Allowed forward transitions; same-state is treated as an idempotent no-op (allowed).
const PARISH_STATUS_TRANSITIONS: Record<ParishStatus, readonly ParishStatus[]> = {
  pending_setup: ["active", "suspended"],
  active: ["suspended"],
  suspended: ["active"],
};

/** Whether a parish may move `from` → `to` (RFC-004 §8). Same-state is an allowed no-op. */
export function canTransitionParishStatus(from: ParishStatus, to: ParishStatus): boolean {
  return from === to || PARISH_STATUS_TRANSITIONS[from].includes(to);
}

/** Versioned, all-optional brand overrides (RFC-004 §7). `v` pins the schema for forward
 *  migration; every field is optional so a tier overrides only what it sets. */
export interface BrandConfig {
  v: 1;
  displayName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  colors?: {
    primary?: string;
    accent?: string;
    onPrimary?: string;
  };
  loginTagline?: string;
  emailFromName?: string;
}

/**
 * Resolve the effective brand by per-field most-specific-wins cascade (RFC-004 §7):
 * system defaults ← diocese.brand ← parish.brand. Each field takes the most-specific tier
 * that DEFINES it; `colors` merges per sub-field the same way, so a parish can override
 * just `primary` and still inherit the diocese `accent`. Absent tiers are skipped (a
 * parish with no brand inherits diocese, then system). Pure; the result omits fields no
 * tier defines. (An empty-string value is intentional and wins — only undefined defers.)
 */
export function resolveBrand(system: BrandConfig, diocese?: BrandConfig, parish?: BrandConfig): BrandConfig {
  const tiers = [system, diocese, parish].filter((t): t is BrandConfig => Boolean(t));
  // Least → most specific; the most-specific tier that DEFINES a field wins.
  const pick = <T>(get: (b: BrandConfig) => T | undefined): T | undefined =>
    tiers.reduce<T | undefined>((acc, t) => get(t) ?? acc, undefined);

  const out: BrandConfig = { v: 1 };
  const displayName = pick((b) => b.displayName);
  if (displayName !== undefined) out.displayName = displayName;
  const logoUrl = pick((b) => b.logoUrl);
  if (logoUrl !== undefined) out.logoUrl = logoUrl;
  const faviconUrl = pick((b) => b.faviconUrl);
  if (faviconUrl !== undefined) out.faviconUrl = faviconUrl;
  const loginTagline = pick((b) => b.loginTagline);
  if (loginTagline !== undefined) out.loginTagline = loginTagline;
  const emailFromName = pick((b) => b.emailFromName);
  if (emailFromName !== undefined) out.emailFromName = emailFromName;

  const primary = pick((b) => b.colors?.primary);
  const accent = pick((b) => b.colors?.accent);
  const onPrimary = pick((b) => b.colors?.onPrimary);
  if (primary !== undefined || accent !== undefined || onPrimary !== undefined) {
    out.colors = {};
    if (primary !== undefined) out.colors.primary = primary;
    if (accent !== undefined) out.colors.accent = accent;
    if (onPrimary !== undefined) out.colors.onPrimary = onPrimary;
  }
  return out;
}

// ─── Parvus Gather — group RBAC contract (RFC-005 §3.2) ───────────────────────
//
// The isomorphic, unit-tested Gather permission contract shared by core + UI, so the
// group-authz vocabulary has ONE definition and can never drift between the server guard
// (`requireGroupPermission`, core) and the client (which actions to offer). The WHOLE §3.2
// union is defined now (the contract) even though T1 only exercises group.*/request.*.
//
// Three SCOPES of permission share this one union (RFC-005 §3.2):
//   • group-INSTANCE — held within ONE group via a member's role.permissions[] (a Grand
//     Knight administers the KofC council only). The bulk of the union.
//   • PARISH-scoped — group.create/delete/archive, health_dashboard.view,
//     parishioner.approve_pending: resolved at the parish tenant (staff in T1), never
//     carried by a group role.
//   • GRANT-FREE — group.self_leave: implicit for every active member, needs no grant.

/**
 * The FIXED Gather permission union (RFC-005 §3.2, "from spec RBAC"). This const array is
 * the single source of truth; {@link GatherPermission} is derived from it (the PARISH_STATUSES
 * idiom) so the type and the runtime list can never disagree. Grouped by area for review.
 */
export const GATHER_PERMISSIONS = [
  // group instance — settings & public discovery profile
  "group.edit_settings",
  "group.edit_public_profile",
  // group instance — roster management
  "group.roster.add",
  "group.roster.invite_new",
  "group.roster.remove",
  "group.roster.assign_role",
  "group.roster.transfer_role",
  "group.roster.approve_join_request",
  // group instance — defining what roles exist/can do: a SEPARATE grant (§3.2), excluded
  // from the default leadership bundle (staff or a founding-admin grant only)
  "group.roles.define",
  // group instance — meetings (§6)
  "meeting.draft",
  "meeting.finalize",
  "meeting.define_recurrence",
  "meeting.set_quorum",
  "agenda_thread.moderate",
  // group instance — sign-ups (§7)
  "signup.create",
  "signup.edit",
  "signup.save_template",
  "signup.instantiate_template",
  // group instance — broadcasts (§8)
  "broadcast.send",
  "broadcast.view_read_receipts",
  // group instance — document vault (§9)
  "document.upload",
  "document.delete",
  // group instance — forms engine (§10)
  "form.create",
  "form.edit",
  "form.delete",
  "form.review_submissions",
  "form.publish_public",
  "form.use_starter_template",
  "form.export_submissions",
  // group instance — requests, the coordination spine (§4)
  "request.create",
  "request.assign",
  "request.manage_board",
  // parish-scoped — group lifecycle + parish-level Gather powers (staff in T1, never a group role)
  "group.create",
  "group.delete",
  "group.archive",
  "health_dashboard.view",
  "parishioner.approve_pending",
  // grant-free — implicit for every member (§3.2)
  "group.self_leave",
] as const;

/** A single Gather permission (RFC-005 §3.2). Derived from {@link GATHER_PERMISSIONS}. */
export type GatherPermission = (typeof GATHER_PERMISSIONS)[number];

/**
 * Parish-scoped permissions (RFC-005 §3.2): resolved at the parish tenant — held by parish
 * staff in T1, NEVER carried by a group role. {@link holdsGroupPermission} refuses them for a
 * non-staff actor regardless of that actor's group role.permissions[].
 */
export const PARISH_SCOPED_PERMISSIONS: ReadonlySet<GatherPermission> = new Set([
  "group.create",
  "group.delete",
  "group.archive",
  "health_dashboard.view",
  "parishioner.approve_pending",
]);

/**
 * Grant-free permissions (RFC-005 §3.2): implicit for every active member, so no role
 * bundle lists them. `group.self_leave` — leaving a group needs no grant.
 */
export const GRANT_FREE_PERMISSIONS: ReadonlySet<GatherPermission> = new Set(["group.self_leave"]);

/**
 * The default leadership bundle (Chair / Coordinator / Lead): every GROUP-INSTANCE
 * permission EXCEPT `group.roles.define` (a separate grant, §3.2). Derived from the union so
 * a new instance permission flows in automatically; the parish-scoped + grant-free
 * permissions are excluded by construction (a group role can grant neither). A parish
 * customizes its roles afterward via `group.roles.define`.
 */
export const GROUP_LEADERSHIP_PERMISSIONS: readonly GatherPermission[] = GATHER_PERMISSIONS.filter(
  (p) => !PARISH_SCOPED_PERMISSIONS.has(p) && !GRANT_FREE_PERMISSIONS.has(p) && p !== "group.roles.define",
);

/**
 * The default member bundle: a plain member may raise a gentle ask (`request.create`) — the
 * invitation-first spine (§4). Leaving a group (`group.self_leave`) is implicit (grant-free),
 * so it is intentionally NOT listed here.
 */
export const GROUP_MEMBER_PERMISSIONS: readonly GatherPermission[] = ["request.create"];

/** The four shapes of the one Group primitive (RFC-005 §3.1 CHECK) — one definition shared
 *  by the migration intent, core, and UI. */
export const GROUP_TYPES = ["committee", "board", "ministry", "event_team"] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

/**
 * A starter role a new group is seeded with: the parish's word for it (`label`), whether it
 * is a leadership role (drives `leaders_only` visibility, §3.1), and its permission bundle.
 * Maps 1:1 onto a `gather_group_roles` row (label, is_leadership, permissions[]).
 */
export interface DefaultGroupRole {
  label: string;
  isLeadership: boolean;
  permissions: readonly GatherPermission[];
}

/**
 * Default role→permission bundles per group type (RFC-005 §3.2: "Default bundles per group
 * type live in shared"). A new group is seeded with these starter roles; a parish then
 * renames/re-scopes them (the `label` is the parish's own word) and adds more via
 * `group.roles.define`. Each type ships ONE leadership role (the full leadership bundle) +
 * one member role; `group.roles.define` (separate grant) and `group.self_leave` (grant-free)
 * therefore appear in no default bundle.
 */
export const DEFAULT_GROUP_ROLES: Record<GroupType, readonly DefaultGroupRole[]> = {
  committee: [
    { label: "Chair", isLeadership: true, permissions: GROUP_LEADERSHIP_PERMISSIONS },
    { label: "Member", isLeadership: false, permissions: GROUP_MEMBER_PERMISSIONS },
  ],
  board: [
    { label: "Chair", isLeadership: true, permissions: GROUP_LEADERSHIP_PERMISSIONS },
    { label: "Member", isLeadership: false, permissions: GROUP_MEMBER_PERMISSIONS },
  ],
  ministry: [
    { label: "Coordinator", isLeadership: true, permissions: GROUP_LEADERSHIP_PERMISSIONS },
    { label: "Member", isLeadership: false, permissions: GROUP_MEMBER_PERMISSIONS },
  ],
  event_team: [
    { label: "Lead", isLeadership: true, permissions: GROUP_LEADERSHIP_PERMISSIONS },
    { label: "Volunteer", isLeadership: false, permissions: GROUP_MEMBER_PERMISSIONS },
  ],
};

/** The inputs `requireGroupPermission` (core) resolves before deciding: the actor's parish
 *  role + the permission bundle of their role WITHIN the group being acted on. */
export interface GroupPermissionActor {
  /** Parish role — parish STAFF implicitly hold every group-scoped permission (§3.2). */
  role: Role;
  /** The actor's `gather_group_roles.permissions[]` for THIS group (empty if no group role). */
  permissions: readonly GatherPermission[];
}

/**
 * The pure decision behind `requireGroupPermission` (core, §3.3) — unit-tested here so the
 * group-authz table (staff short-circuit, instance scoping, the roles.define gate) is locked
 * in shared. The core shim does the async work (module-enabled → getDb(parishId) → load
 * member.role_id.permissions) then calls this:
 *   • parish STAFF short-circuit to allow ANY permission (older-volunteer on-behalf, §3.2);
 *   • `group.self_leave` (grant-free) is allowed for everyone;
 *   • a PARISH-scoped permission is never satisfied by a group role — a non-staff actor is
 *     refused (it is a parish-tenant decision, not a group-role grant, §3.2);
 *   • otherwise the permission must be in the actor's group role bundle (INSTANCE scoping —
 *     a role in group A grants nothing in group B).
 * Group VISIBILITY (public/members_only/leaders_only) is a separate read filter (§3.3).
 */
export function holdsGroupPermission(actor: GroupPermissionActor, perm: GatherPermission): boolean {
  if (isStaff(actor.role)) return true;
  if (GRANT_FREE_PERMISSIONS.has(perm)) return true;
  if (PARISH_SCOPED_PERMISSIONS.has(perm)) return false;
  return actor.permissions.includes(perm);
}

// ─── Parvus Gather — Requests state machine (RFC-005 §4.2) ────────────────────
//
// A Requestable is a gentle ticket (§4): someone asks a person OR a group-role pool to do a
// thing; they do it, hand it back, or gently decline; the asker sees it handled. Tone is
// part of the model — surfaced copy lives in the GATHER_*_COPY constants below, never
// "task/queue". This is the single coordination spine every Gather flow emits into (§4.4).

/** Requestable lifecycle states (RFC-005 §4.1 CHECK / §4.2). `done`/`declined`/`cancelled`
 *  are terminal. */
export const REQUEST_STATUSES = ["open", "assigned", "in_progress", "done", "declined", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Gentle 3-level priority (RFC-005 §4.1/§4.5) — a soft sense of urgency, never P1–P4. */
export const REQUEST_PRIORITIES = ["low", "normal", "soon"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** The transitions a Requestable supports (RFC-005 §4.2). Reassign / re-prioritize are
 *  field updates that do NOT change status (gated by request.manage_board), so they are
 *  intentionally not modeled by {@link nextRequestStatus}. */
export const REQUEST_ACTIONS = ["assign", "claim", "start", "done", "decline", "hand_back", "cancel"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/**
 * The actor's relationship to the Requestable, resolved by the core shim before a
 * transition. The pure machine encodes the workflow authorization INTRINSIC to each action
 * (only the assignee may start/finish; only the requester may cancel) — these cannot be
 * delegated by a group permission. `canManageBoard`/`isStaff` widen who may direct or triage.
 */
export interface RequestActor {
  /** Created the ask — the only one who may `cancel` it (RFC-005 §4.2). */
  isRequester: boolean;
  /** Currently holds the ask — may `start` / `done` / `decline` / `hand_back`. */
  isAssignee: boolean;
  /** Holds the role the ask was offered to — may `claim` an open pool ask (§4.2). */
  isPoolEligible: boolean;
  /** Holds request.assign/manage_board on the owning group — may `assign` on the board (§4.3). */
  canManageBoard: boolean;
  /** Parish staff — acts on any parishioner's behalf (older-volunteer rule, §3.2); may
   *  perform any STATE-legal action. */
  isStaff: boolean;
}

/**
 * Pure Requestable transition (RFC-005 §4.2): `open → assigned → in_progress → done`, with
 * `declined` / `cancelled` exits. Returns the next status for a legal (source-state + actor)
 * combination, or `null` to REJECT — an illegal source state OR an unauthorized actor.
 * Associated data changes are applied by the core (claim/assign set the assignee; hand_back
 * clears it and re-offers to the pool; done sets completed_at + fires the thank-you, §4.2).
 * `decline`/`hand_back` are allowed from `in_progress` too, so an assignee who started can
 * always bow out "with grace, no guilt" (§4.2) rather than being trapped (cancel is
 * requester-only). Terminal states accept no action — not even staff.
 */
export function nextRequestStatus(
  cur: RequestStatus,
  action: RequestAction,
  actor: RequestActor,
): RequestStatus | null {
  const staff = actor.isStaff;
  switch (action) {
    case "assign": // requester directs it — or a board manager triages it — to a person
      if (cur !== "open") return null;
      return actor.isRequester || actor.canManageBoard || staff ? "assigned" : null;
    case "claim": // a pool-eligible member pulls an open ask from the role pool
      if (cur !== "open") return null;
      return actor.isPoolEligible || staff ? "assigned" : null;
    case "start": // the assignee begins
      if (cur !== "assigned") return null;
      return actor.isAssignee || staff ? "in_progress" : null;
    case "done": // the assignee finishes (core sets completed_at + fires a thank-you)
      if (cur !== "assigned" && cur !== "in_progress") return null;
      return actor.isAssignee || staff ? "done" : null;
    case "hand_back": // the assignee re-offers it to the pool — no guilt
      if (cur !== "assigned" && cur !== "in_progress") return null;
      return actor.isAssignee || staff ? "open" : null;
    case "decline": // the assignee gently says "not this time"
      if (cur !== "assigned" && cur !== "in_progress") return null;
      return actor.isAssignee || staff ? "declined" : null;
    case "cancel": // requester only (or staff on-behalf) — no longer needed
      if (cur !== "open" && cur !== "assigned" && cur !== "in_progress") return null;
      return actor.isRequester || staff ? "cancelled" : null;
    default:
      return null; // unknown action (defensive against an unvalidated string)
  }
}

// ─── Parvus Gather — invitation-first copy (RFC-005 §4.5, §15) ────────────────
//
// The locked, invitation-first voice lives in shared so NO component can build corporate
// task UI on the Requests model (§4.5): every ask is an invitation, gratitude on completion,
// gentle nudges. `GATHER_NEVER_SAY` is the guardrail — a unit test asserts that no constant
// below contains a banned word, so the tone cannot regress at the source (§15).

/** Words Gather's surfaced copy must NEVER use — it is invitation-first, not a work tracker
 *  (RFC-005 §4.5/§15). Enforced by {@link gatherToneViolations} + a unit test over the copy. */
export const GATHER_NEVER_SAY: readonly string[] = ["task", "queue", "overdue", "assigned to you"];

/** The lowercased banned words from {@link GATHER_NEVER_SAY} that appear in `text` (empty =
 *  clean). Backs the guardrail test over the copy constants; usable as a dev check on any
 *  Gather-facing string. */
export function gatherToneViolations(text: string): string[] {
  const lower = text.toLowerCase();
  return GATHER_NEVER_SAY.filter((w) => lower.includes(w));
}

/** Invitation-first phrases (RFC-005 §4.5): the asker line, the gentle CTA, the graceful no,
 *  and the gratitude on completion. */
export const GATHER_INVITATION_COPY = {
  /** Precedes the asker, e.g. "Maria asked you to help bring the readings." */
  askedYouToHelp: "asked you to help",
  /** The gentle CTA on an invitation. */
  canYou: "Can you?",
  /** Declining, with grace (never "reject" / "refuse"). */
  notThisTime: "Not this time",
  /** Gratitude shown on completion (§4.2 thank-you). */
  thankYou: "Thank you",
} as const;

/** Invitation-first label for each Requestable status (RFC-005 §4.5) — what the state is
 *  CALLED in the UI. Never "queue" / "overdue" / "assigned to you". */
export const REQUEST_STATUS_COPY: Record<RequestStatus, string> = {
  open: "Open invitation",
  assigned: "You're helping",
  in_progress: "Underway",
  done: "All done — thank you",
  declined: "Not this time",
  cancelled: "No longer needed",
};

/** Gentle label for each priority (RFC-005 §4.5) — a soft sense, never "urgent" / "overdue". */
export const REQUEST_PRIORITY_COPY: Record<RequestPriority, string> = {
  low: "Whenever you can",
  normal: "When you have a moment",
  soon: "Sooner would help",
};

/** Invitation-first label for each transition action (RFC-005 §4.2/§4.5). */
export const REQUEST_ACTION_COPY: Record<RequestAction, string> = {
  assign: "Ask someone",
  claim: "I can help",
  start: "Get started",
  done: "Mark done, with thanks",
  decline: "Not this time",
  hand_back: "Pass it on",
  cancel: "No longer needed",
};
