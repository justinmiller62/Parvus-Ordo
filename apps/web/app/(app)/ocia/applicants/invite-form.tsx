"use client";

import { useActionState } from "react";
import { ROLE_LABELS, type Role } from "@parvaordo/shared";
import { type InviteState, inviteMemberAction } from "./actions";

const initial: InviteState = { ok: false };

/** Direct invite-by-email. `roles` are the roles the current caller may grant. */
export function InviteForm({ roles }: { roles: Role[] }) {
  const [state, action, pending] = useActionState(inviteMemberAction, initial);

  return (
    <form action={action} className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-navy">Invite a member</h2>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          placeholder="email@example.com"
          data-testid="invite-email"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          name="role"
          defaultValue="catechumen_candidate"
          data-testid="invite-role"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          data-testid="invite-submit"
          className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {state.ok ? (
        <p className="mt-2 text-sm text-green-700" data-testid="invite-success">
          {state.message}
        </p>
      ) : state.error ? (
        <p className="mt-2 text-sm text-rose" data-testid="invite-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
