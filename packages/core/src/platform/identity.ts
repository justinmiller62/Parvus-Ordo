import type { Role } from "@parvaordo/shared";
import { getDb } from "../db/client";

export interface ParishMembership {
  parishId: string;
  parishName: string;
  parishHostname: string | null;
  role: Role;
}

export interface AppIdentity {
  userId: string;
  displayName: string;
  isSuperAdmin: boolean;
  /** PRIMARY membership's role/parish (back-compat). The ACTIVE one is resolved per
   * request in getViewer from the hostname / chooser; null when no membership yet. */
  role: Role | null;
  parishId: string | null;
  /** Every parish this user belongs to (one role each). */
  memberships: ParishMembership[];
}

interface LookupRow {
  user_id: string;
  display_name: string;
  is_super_admin: boolean;
  role: Role | null;
  parish_id: string | null;
  parish_name: string | null;
  parish_hostname: string | null;
}

/**
 * Map an authenticated email to the app's identity + ALL memberships via the
 * login_lookup SECURITY DEFINER function (cross-tenant, pre-tenant-context).
 * Returns null when no matching user exists.
 */
export async function lookupAppUser(email: string): Promise<AppIdentity | null> {
  const { rows } = await getDb(null).query<LookupRow>(
    "SELECT user_id, display_name, is_super_admin, role, parish_id, parish_name, parish_hostname FROM login_lookup($1)",
    [email],
  );
  const first = rows[0];
  if (!first) return null;

  // One membership per parish (login_lookup orders parish-wide before ministry-scoped).
  const seen = new Set<string>();
  const memberships: ParishMembership[] = [];
  for (const r of rows) {
    if (r.parish_id && r.role && !seen.has(r.parish_id)) {
      seen.add(r.parish_id);
      memberships.push({
        parishId: r.parish_id,
        parishName: r.parish_name ?? "",
        parishHostname: r.parish_hostname,
        role: r.role,
      });
    }
  }
  const primary = memberships[0] ?? null;
  return {
    userId: first.user_id,
    displayName: first.display_name,
    isSuperAdmin: first.is_super_admin,
    role: primary?.role ?? null,
    parishId: primary?.parishId ?? null,
    memberships,
  };
}

/**
 * Resolve which membership is "active" for a request: an explicit parish (a chooser
 * pick / cookie) wins, then the parish resolved from the request hostname (see
 * resolveParishIdForHost — slug or custom domain), then the sole membership. Returns
 * null when the choice is ambiguous (2+ memberships and no hint) — the caller then
 * shows the "Choose a parish" screen. Pure + testable; both hints are parish ids.
 */
export function pickActiveMembership(
  memberships: ParishMembership[],
  opts: { parishId?: string | null; hostParishId?: string | null } = {},
): ParishMembership | null {
  if (memberships.length === 0) return null;
  // SECURITY (tenant boundary): both hints — the client-controlled po_active_parish
  // cookie and the request host — are UNTRUSTED. They may only SELECT among the user's
  // own memberships via this .find(); a hint for a parish the user doesn't hold finds no
  // match and is ignored. Never return (or feed getDb) a parishId that isn't already in
  // `memberships`, and never trust a hint directly — that would be a cross-tenant
  // escalation. Locked by identity.test.ts "tenant boundary" cases. (po-h8v)
  for (const hint of [opts.parishId, opts.hostParishId]) {
    if (hint) {
      const match = memberships.find((x) => x.parishId === hint);
      if (match) return match;
    }
  }
  return memberships.length === 1 ? memberships[0]! : null;
}

/**
 * Authorize an iOS bearer-token request against the user's CURRENT memberships.
 *
 * The app token is bound to a parish at mint time; `boundParishId` is that claim. We
 * re-check it against live memberships on every request (authenticateApiRequest re-reads
 * the DB via lookupAppUser each call), so a user removed from the bound parish loses API
 * access on their next request — the revocation / deactivated-user cutoff a 30-day,
 * non-revocable token otherwise lacks (po-u79). Returns the live membership (whose role
 * is authoritative for the request), or null when the token carries no parish or the
 * user is no longer a member of it — the caller then returns 401.
 */
export function authorizeApiToken(
  boundParishId: string | null | undefined,
  memberships: ParishMembership[],
): ParishMembership | null {
  if (!boundParishId) return null;
  return memberships.find((x) => x.parishId === boundParishId) ?? null;
}
