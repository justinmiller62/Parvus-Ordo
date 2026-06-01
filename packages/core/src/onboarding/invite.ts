import type { Role } from "@parvaordo/shared";
import { withTenant } from "../db/client";
import { canInviteRole } from "./roles";

export interface InviteInput {
  email: string;
  fullName?: string;
  role: Role;
}

/** The acting user, resolved from the request (getViewer) by the Server Action. */
export interface InviteCaller {
  userId: string;
  role: Role | null;
  parishId: string;
}

export interface InviteResult {
  userId: string;
  isNewUser: boolean;
  /** Whether a WorkOS invitation email was sent (false = no WORKOS_API_KEY; the
   * account still resolves to this membership on first login, keyed by email). */
  invitationSent: boolean;
}

/** Typed failures the Server Action maps to user-facing messages / HTTP semantics. */
export class InviteError extends Error {
  constructor(
    public code: "forbidden" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

/**
 * Send the account-invitation email via the WorkOS User Management API (org-less:
 * tenancy lives in our memberships table, so no organization_id). A per-parish
 * WorkOS Organization can be added later for parishes that want SSO without
 * touching this path. No-op when WORKOS_API_KEY is unset (tests / local without
 * creds) — the seeded membership still resolves on first WorkOS login by email.
 */
async function sendInvitationEmail(email: string): Promise<boolean> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) return false;
  const res = await fetch("https://api.workos.com/user_management/invitations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // 409 = WorkOS already has a pending invite / user for this email — not an error here.
  if (!res.ok && res.status !== 409) {
    throw new InviteError("invalid", `WorkOS invitation failed (${res.status})`);
  }
  return true;
}

/**
 * Invite a person to a parish with a role. Holds ALL the onboarding logic
 * (ported from Narthex's invite-user Edge Function):
 *   - authz: caller must be admin/catechist/super_admin in the parish; a catechist
 *     may not mint an admin (→ InviteError "forbidden").
 *   - upsert the local user by email (users has no RLS; a person may already exist
 *     in another parish).
 *   - dedupe on (user, parish, role) (→ InviteError "conflict"). The DB UNIQUE
 *     includes ministry_id, and NULLs don't collide, so this explicit check is the
 *     real guard for parish-wide memberships.
 *   - create the membership, then send the WorkOS invitation email.
 */
export async function inviteMember(input: InviteInput, caller: InviteCaller): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new InviteError("invalid", "a valid email is required");
  if (!canInviteRole(caller.role, input.role)) {
    throw new InviteError("forbidden", `your role may not invite a ${input.role}`);
  }
  const displayName = input.fullName?.trim() || email.split("@")[0]!;

  const { userId, isNewUser } = await withTenant(caller.parishId, async (q) => {
    const existing = await q<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1", [email]);
    let id = existing[0]?.id ?? null;
    const fresh = !id;
    if (!id) {
      const ins = await q<{ id: string }>(
        "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
        [email, displayName],
      );
      id = ins[0]!.id;
    }
    // RLS scopes this SELECT/INSERT to caller.parishId (app.parish_id is set).
    const dupe = await q("SELECT 1 FROM memberships WHERE user_id = $1 AND parish_id = $2 AND role = $3", [
      id,
      caller.parishId,
      input.role,
    ]);
    if (dupe.length) throw new InviteError("conflict", "this person already has that role in this parish");
    await q("INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, $3)", [
      id,
      caller.parishId,
      input.role,
    ]);
    return { userId: id!, isNewUser: fresh };
  });

  // Send the email AFTER the transaction commits (don't hold the tx open on a network call).
  const invitationSent = await sendInvitationEmail(email);
  return { userId, isNewUser, invitationSent };
}

/** Pending WorkOS invitations (env-wide; the caller intersects with parish members
 * to scope it). Empty when WORKOS_API_KEY is unset (local/tests). */
export async function listPendingInvitations(): Promise<{ id: string; email: string }[]> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) return [];
  const res = await fetch("https://api.workos.com/user_management/invitations?limit=100", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { id: string; email: string; state: string }[] };
  return (body.data ?? []).filter((i) => i.state === "pending").map((i) => ({ id: i.id, email: i.email }));
}

/** Revoke a pending WorkOS invitation. No-op without WORKOS_API_KEY. */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) return;
  await fetch(`https://api.workos.com/user_management/invitations/${invitationId}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
