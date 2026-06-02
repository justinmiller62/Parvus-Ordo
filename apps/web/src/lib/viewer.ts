import { cache } from "react";
import { cookies, headers } from "next/headers";
import { IMPERSONATABLE_ROLES, type Role } from "@parvaordo/shared";
import { type AppIdentity, type ParishMembership, lookupViewerContext, pickActiveMembership } from "@parvaordo/core";
import { type AuthedUser, getAuthedUser } from "./auth";

export const VIEW_AS_COOKIE = "po_view_as";
export const ACTIVE_PARISH_COOKIE = "po_active_parish";

export interface Viewer {
  authed: AuthedUser;
  /** EFFECTIVE identity — role/parish reflect the ACTIVE membership (and any
   * super-admin impersonation). `identity.memberships` lists all of them. */
  identity: AppIdentity | null;
  /** The real user is a super-admin (the `is_super_admin` flag). */
  canImpersonate: boolean;
  /** The role currently being mimicked, or null. */
  viewingAs: Role | null;
  /** 2+ memberships and no host/cookie hint → show the "Choose a parish" screen. */
  needsParishChoice: boolean;
}

/**
 * The current viewer (auth + identity), deduped per request via React cache.
 *
 * A user can belong to multiple parishes; the ACTIVE one is resolved per request:
 * an explicit chooser pick (the `po_active_parish` cookie) wins, then the request
 * hostname (each parish has its own domain), then the sole membership. With 2+
 * memberships and no hint, `needsParishChoice` is set so the layout shows a chooser.
 *
 * Super-admins can additionally "view as" another role within the active parish
 * (applied to the EFFECTIVE role only when the real user is a super-admin — a forged
 * cookie escalates no one, since super-admin → any role is a de-escalation).
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const authed = await getAuthedUser();
  if (!authed) return null;

  const jar = await cookies();
  const host = (await headers()).get("host");
  // Identity (login_lookup) AND the host→parish resolve (resolve_parish_id) come back in a
  // SINGLE pre-tenant round trip, not two (RFC-002 §2B2).
  const { identity: real, hostParishId } = await lookupViewerContext(authed.email, host);
  if (!real) return { authed, identity: null, canImpersonate: false, viewingAs: null, needsParishChoice: false };

  // Both hints — the po_active_parish cookie and the host-resolved parish — are UNTRUSTED;
  // pickActiveMembership cross-checks each against the user's own memberships. The effective
  // parishId below comes from the matched membership, never from a raw hint, so it is safe to
  // feed getDb. Never bypass pickActiveMembership with a hint value directly.
  const active: ParishMembership | null = pickActiveMembership(real.memberships, {
    parishId: jar.get(ACTIVE_PARISH_COOKIE)?.value,
    hostParishId,
  });
  const needsParishChoice = !active && real.memberships.length > 1;

  let role: Role | null = active?.role ?? real.role;
  const parishId = active?.parishId ?? real.parishId;

  const canImpersonate = real.isSuperAdmin;
  let viewingAs: Role | null = null;
  if (canImpersonate) {
    const cookie = jar.get(VIEW_AS_COOKIE)?.value as Role | undefined;
    if (cookie && IMPERSONATABLE_ROLES.includes(cookie) && cookie !== role) {
      role = cookie;
      viewingAs = cookie;
    }
  }

  return { authed, identity: { ...real, role, parishId }, canImpersonate, viewingAs, needsParishChoice };
});
