import {
  type BrandConfig,
  canTransitionParishStatus,
  isValidSlug,
  MODULES,
  type ModuleKey,
  type ParishStatus,
  PARISH_STATUSES,
} from "@parvaordo/shared";
import { getDb } from "../db/client";
import { inviteMember, InviteError, type InviteResult } from "../onboarding/invite";

/**
 * platform/admin.ts — the super-admin-gated admin plane (RFC-004 §3/§5/§6/§10/§11/§12).
 *
 * ALL super-admin platform logic lives here; the entry points (the admin route group +
 * requireSuperAdmin, RFC-004 §6 / bead po-4t5j) are thin shims per CLAUDE.md §5. Every
 * exported mutation:
 *   1. RE-ASSERTS super-admin server-side (`requireSuperAdmin`, below) — an authoritative
 *      DB read of `users.is_super_admin`, independent of (and in addition to) the route-layer
 *      gate. This closes the gap that the first DEFINER batch (0030 create_parish/set_status)
 *      is NOT self-authorizing: the actor arg there is audit attribution only, so the core
 *      layer is their real gate. The 0031 write fns re-assert again in-DB (admin_require_super)
 *      — defense in depth across all three layers (route → core → SQL).
 *   2. Routes cross-tenant work through the SECURITY DEFINER functions (0030/0031). The app
 *      role (getDb(null)) cannot INSERT a parish or write another tenant's row directly —
 *      parishes RLS is `USING (id = app.parish_id)` with no INSERT policy (0001) — so creation
 *      and cross-tenant writes REQUIRE the DEFINER fns.
 *   3. Appends an admin_audit row. The DEFINER mutations self-write their audit atomically;
 *      actions with no dedicated DEFINER fn (inviteFirstAdmin) call {@link writeAdminAudit}.
 *
 * NOT here — IMPERSONATION ("view as parish"): the begin/end impersonation read-write semantics
 * + the signed `po_impersonate_parish` cookie are owned by the separate censor-required bead
 * po-dz6p (RFC-004 §16-D2, "see B7 bead"). Cookies are an app-layer (Next) concern core cannot
 * touch, and po-dz6p's beginImpersonation Server Action is the highest-risk Censor subject; we
 * deliberately do NOT duplicate that surface here. po-dz6p audits impersonation start/end via
 * {@link writeAdminAudit} (or admin_write_audit directly) — the generic seam this module exposes.
 *
 * NOT here — RICH cross-parish stats (membersByRole, lesson/cohort counts, lastActivityAt):
 * owned by the super-admin stats dashboard bead po-l6su, which holds the cross-parish read/
 * aggregation path (rector decision on po-juwe). {@link getParishStats} returns the lightweight
 * shell stats the 0030 DEFINER provides (status + member/ministry counts).
 */

/** Typed admin-plane failures the route shim maps to HTTP semantics (mirrors InviteError). */
export class AdminError extends Error {
  constructor(
    public code: "forbidden" | "invalid" | "conflict" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/**
 * The authoritative super-admin gate. Re-reads `users.is_super_admin` for the actor (users has
 * no RLS; the app role has SELECT — 0001) and throws `forbidden` unless it is strictly true.
 * Fail-closed: a missing user, a NULL flag, or `false` all deny; only a genuine `true` passes.
 * Unexpected DB errors (outage, malformed actor id) propagate as-is so an outage surfaces as a
 * 5xx, not a misleading 403. Called by EVERY exported mutation/read here — "re-asserts" in the
 * RFC sense: the core layer never trusts an upstream "is super-admin" assertion.
 */
async function requireSuperAdmin(actorUserId: string): Promise<void> {
  const { rows } = await getDb(null).query<{ is_super_admin: boolean }>(
    "SELECT is_super_admin FROM users WHERE id = $1::uuid",
    [actorUserId],
  );
  if (rows[0]?.is_super_admin !== true) {
    throw new AdminError("forbidden", "super-admin privileges required");
  }
}

/** A pg driver error carries a SQLSTATE on `.code`. */
function isPgError(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * Translate the DEFINER fns' RAISEd SQLSTATEs into typed AdminErrors so the route shim handles
 * one error shape. We pre-validate the pure cases (slug shape, toggleable, transition) in TS for
 * a fast, clear failure; this catches the DB-only outcomes — global slug/domain uniqueness and
 * target-not-found — which only the write can know. Anything unmapped re-throws unchanged.
 */
function classifyPgError(err: unknown): AdminError | null {
  if (!isPgError(err)) return null;
  switch (err.code) {
    case "23505": // unique_violation — slug taken / custom-domain collision (the resolve key)
      return new AdminError("conflict", "that value is already in use by another parish");
    case "23514": // check_violation — reserved/malformed slug, non-toggleable module, bad status
      return new AdminError("invalid", "the request failed a database validation check");
    case "P0002": // no_data_found — UPDATE matched no parish (admin_set_* "parish not found")
      return new AdminError("not_found", "the target parish was not found");
    case "42501": // insufficient_privilege — admin_require_super rejected the actor (0031)
      return new AdminError("forbidden", "super-admin privileges required");
    default:
      return null;
  }
}

/** Run a DEFINER write, mapping its RAISEd SQLSTATE to an AdminError. */
async function definerWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const mapped = classifyPgError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

// ─── Audit seam ───────────────────────────────────────────────────────────────
/**
 * Append one admin_audit row via the DEFINER writer (the ONLY way the app role may touch the
 * RLS-locked, grant-revoked admin_audit table — 0030). For privileged actions with no dedicated
 * DEFINER fn: inviteFirstAdmin here, and impersonation start/end in po-dz6p. Re-asserts
 * super-admin so the exported seam can never be used to forge audit rows. `detail` must carry NO
 * secrets (an invited admin's email is PII, not a secret — acceptable per the 0030 audit contract).
 * Returns the new audit row id.
 */
export async function writeAdminAudit(
  actorUserId: string,
  action: string,
  targetParishId: string | null,
  detail: Record<string, unknown> = {},
): Promise<string> {
  await requireSuperAdmin(actorUserId);
  const { rows } = await getDb(null).query<{ id: string }>("SELECT admin_write_audit($1, $2, $3, $4::jsonb) AS id", [
    actorUserId,
    action,
    targetParishId,
    JSON.stringify(detail),
  ]);
  return rows[0]!.id;
}

// ─── Provisioning ─────────────────────────────────────────────────────────────
export interface ProvisionParishInput {
  name: string;
  slug: string;
  dioceseId: string;
}

/**
 * Provision a BARE parish shell (RFC-004 §5; locked answer po-wisp-rrwul): status
 * `pending_setup`, sparse module defaults, empty brand — NO admin invite, NO ministries seed.
 * A super-admin later hands the parish admin a setup link (and may inviteFirstAdmin separately).
 * Slug shape is pre-validated (isValidSlug → reserved labels + DNS shape); global uniqueness is
 * the parishes.slug UNIQUE constraint, surfaced as `conflict`. Returns the new parish id.
 */
export async function provisionParish(actorUserId: string, input: ProvisionParishInput): Promise<string> {
  await requireSuperAdmin(actorUserId);
  const name = input.name.trim();
  if (!name) throw new AdminError("invalid", "a parish name is required");
  if (!isValidSlug(input.slug)) {
    throw new AdminError("invalid", "slug must be lowercase letters, digits and hyphens (3–63 chars), not reserved");
  }
  const { rows } = await definerWrite(() =>
    getDb(null).query<{ id: string }>("SELECT admin_create_parish($1, $2, $3, $4::uuid) AS id", [
      actorUserId,
      name,
      input.slug,
      input.dioceseId,
    ]),
  );
  return rows[0]!.id;
}

// ─── Cross-tenant reads ───────────────────────────────────────────────────────
export interface AdminParish {
  id: string;
  name: string;
  slug: string;
  dioceseId: string | null;
  status: ParishStatus;
  primaryHostname: string | null;
  createdAt: Date;
}

/** Every parish, cross-tenant (admin_list_parishes DEFINER bypasses the per-tenant RLS view). */
export async function listParishes(actorUserId: string): Promise<AdminParish[]> {
  await requireSuperAdmin(actorUserId);
  const { rows } = await getDb(null).query<{
    id: string;
    name: string;
    slug: string;
    diocese_id: string | null;
    status: ParishStatus;
    primary_hostname: string | null;
    created_at: Date;
  }>("SELECT id, name, slug, diocese_id, status, primary_hostname, created_at FROM admin_list_parishes()");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    dioceseId: r.diocese_id,
    status: r.status,
    primaryHostname: r.primary_hostname,
    createdAt: r.created_at,
  }));
}

export interface AdminParishStats {
  parishId: string;
  status: ParishStatus;
  memberCount: number;
  ministryCount: number;
}

/**
 * Lightweight shell stats for one parish (status + member/ministry counts). Returns null when
 * the parish does not exist. RICH cross-parish aggregation (roles, lessons, cohorts, activity)
 * is the super-admin stats dashboard's job (po-l6su) — kept out of this provisioning module.
 */
export async function getParishStats(actorUserId: string, parishId: string): Promise<AdminParishStats | null> {
  await requireSuperAdmin(actorUserId);
  const { rows } = await getDb(null).query<{
    parish_id: string;
    status: ParishStatus;
    member_count: string;
    ministry_count: string;
  }>("SELECT parish_id, status, member_count, ministry_count FROM admin_get_parish_stats($1::uuid)", [parishId]);
  const r = rows[0];
  if (!r) return null;
  // bigint counts arrive as strings over the wire.
  return {
    parishId: r.parish_id,
    status: r.status,
    memberCount: Number(r.member_count),
    ministryCount: Number(r.ministry_count),
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
/**
 * Set a parish's lifecycle status (RFC-004 §8). The DEFINER admin_set_status validates the
 * value but NOT transition legality, so we enforce it here via the shared canTransitionParishStatus
 * (read current → check → set). A missing parish is `not_found`; an illegal move (e.g. active →
 * pending_setup) is `invalid`. The suspend/activate UX + suspended-parish lockout consume this
 * (po-f98k). Best-effort transition check: read-then-write is not one transaction, but the admin
 * plane is single-super-admin and low-traffic, so a racing status change is not a concern here.
 */
export async function setParishStatus(actorUserId: string, parishId: string, status: ParishStatus): Promise<void> {
  await requireSuperAdmin(actorUserId);
  if (!PARISH_STATUSES.includes(status)) {
    throw new AdminError("invalid", `unknown parish status: ${String(status)}`);
  }
  const current = await currentStatus(parishId);
  if (current === null) throw new AdminError("not_found", "the target parish was not found");
  if (!canTransitionParishStatus(current, status)) {
    throw new AdminError("invalid", `cannot move a parish from ${current} to ${status}`);
  }
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_status($1, $2::uuid, $3)", [actorUserId, parishId, status]),
  );
}

/** The parish's current lifecycle status, or null if it does not exist (DEFINER read). */
async function currentStatus(parishId: string): Promise<ParishStatus | null> {
  const { rows } = await getDb(null).query<{ status: ParishStatus }>(
    "SELECT status FROM admin_get_parish_stats($1::uuid)",
    [parishId],
  );
  return rows[0]?.status ?? null;
}

// ─── Subdomain + custom domains ───────────────────────────────────────────────
/**
 * Repoint a parish's subdomain slug. Shape pre-validated (isValidSlug → reserved + DNS shape);
 * GLOBAL uniqueness is the parishes.slug UNIQUE constraint, surfaced as `conflict`.
 */
export async function setParishSubdomain(actorUserId: string, parishId: string, slug: string): Promise<void> {
  await requireSuperAdmin(actorUserId);
  if (!isValidSlug(slug)) {
    throw new AdminError("invalid", "slug must be lowercase letters, digits and hyphens (3–63 chars), not reserved");
  }
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_parish_subdomain($1, $2::uuid, $3)", [actorUserId, parishId, slug]),
  );
}

// A bare registrable hostname: lowercase DNS labels (letter/digit/hyphen, no leading/trailing
// hyphen), ≤63 chars each, ≥2 labels (must contain a dot), ≤253 total. No scheme, port, path, or
// whitespace — custom_domains is the host→parish resolve key (0010), not a URL.
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Pure shape check for a custom domain (the resolve key). Lowercases first, so callers may pass
 * mixed-case. Pure + exported so the route/admin UI (po-4t5j) rejects the same hostnames the core
 * write does — the custom-domain analogue of {@link isValidSlug} for subdomains.
 */
export function isValidCustomDomain(domain: string): boolean {
  return HOSTNAME_RE.test(domain.trim().toLowerCase());
}

/** Trim + lowercase + dedupe + shape-validate the custom-domain list (mirrors the DEFINER's
 *  normalize, but throws a clear `invalid` before the round trip). */
function normalizeCustomDomains(domains: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of domains) {
    const d = raw.trim().toLowerCase();
    if (!isValidCustomDomain(d)) {
      throw new AdminError("invalid", `not a valid hostname: ${raw}`);
    }
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/**
 * Replace a parish's custom domains. Each is normalized + shape-validated here; a domain already
 * claimed by ANOTHER parish (the resolve key) is rejected by the DEFINER as `conflict`.
 */
export async function setCustomDomains(actorUserId: string, parishId: string, domains: string[]): Promise<void> {
  await requireSuperAdmin(actorUserId);
  const normalized = normalizeCustomDomains(domains);
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_parish_custom_domains($1, $2::uuid, $3)", [actorUserId, parishId, normalized]),
  );
}

// ─── Module enablement ────────────────────────────────────────────────────────
/** Reject a key that is not a real module or is always-on (only ocia/studio toggle — locked
 *  answer po-wisp-rrwul). Pure guard shared by parish + diocese toggles. */
function assertToggleable(key: ModuleKey): void {
  const def = MODULES[key];
  if (!def) throw new AdminError("invalid", `unknown module: ${String(key)}`);
  if (!def.toggleable) throw new AdminError("invalid", `the ${def.label} module is always-on and cannot be toggled`);
}

/** Enable/disable a toggleable module for one parish (writes parish_modules). */
export async function setModuleEnabled(
  actorUserId: string,
  parishId: string,
  key: ModuleKey,
  enabled: boolean,
): Promise<void> {
  await requireSuperAdmin(actorUserId);
  assertToggleable(key);
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_module_enabled($1, $2::uuid, $3, $4)", [actorUserId, parishId, key, enabled]),
  );
}

/**
 * Set a diocese-wide module default (writes diocese_modules, po-ekjb). The diocese sits ABOVE the
 * parish tenant in the cascade (defaults ← diocese ← parish), so this is an elevated write over
 * po-ekjb's tenant-facing resolver.
 */
export async function setDioceseModuleDefault(
  actorUserId: string,
  dioceseId: string,
  key: ModuleKey,
  enabled: boolean,
): Promise<void> {
  await requireSuperAdmin(actorUserId);
  assertToggleable(key);
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_diocese_module_default($1, $2::uuid, $3, $4)", [
      actorUserId,
      dioceseId,
      key,
      enabled,
    ]),
  );
}

// ─── Branding ─────────────────────────────────────────────────────────────────
/**
 * Set a parish's brand overrides (parishes.brand jsonb; the most-specific cascade tier — §7).
 * The branding editor (po-ei1h) builds the UI + the chrome/login/email cascade on top. Brand
 * carries no secrets. We pin the schema version (`v: 1`) defensively before persisting.
 */
export async function setParishBrand(actorUserId: string, parishId: string, brand: BrandConfig): Promise<void> {
  await requireSuperAdmin(actorUserId);
  if (brand.v !== 1) throw new AdminError("invalid", "unsupported brand schema version");
  await definerWrite(() =>
    getDb(null).query("SELECT admin_set_parish_brand($1, $2::uuid, $3::jsonb)", [
      actorUserId,
      parishId,
      JSON.stringify(brand),
    ]),
  );
}

// ─── First-admin invite ───────────────────────────────────────────────────────
/**
 * Invite the FIRST parish admin of a freshly-provisioned shell. Wraps the existing
 * inviteMember({role:'admin'}) onboarding path (WorkOS; no token table) with the super-admin as
 * caller, then audits it. canInviteRole(super_admin → admin) is satisfied; inviteMember runs in
 * the target parish's tenant context (getDb(parishId)) and creates the membership. InviteError is
 * re-wrapped as AdminError so this module presents one error shape. The audit is written AFTER a
 * successful invite (so we never record an invite that errored); on the rare admin_write_audit
 * failure the invite has already landed and the error propagates for the super-admin to retry/inspect.
 */
export async function inviteFirstAdmin(actorUserId: string, parishId: string, email: string): Promise<InviteResult> {
  await requireSuperAdmin(actorUserId);
  let result: InviteResult;
  try {
    result = await inviteMember({ email, role: "admin" }, { userId: actorUserId, role: "super_admin", parishId });
  } catch (err) {
    if (err instanceof InviteError) throw new AdminError(err.code, err.message);
    throw err;
  }
  await writeAdminAudit(actorUserId, "invite_first_admin", parishId, {
    email: email.trim().toLowerCase(),
    invited_user_id: result.userId,
    is_new_user: result.isNewUser,
  });
  return result;
}
