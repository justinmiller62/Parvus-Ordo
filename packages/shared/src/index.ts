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
