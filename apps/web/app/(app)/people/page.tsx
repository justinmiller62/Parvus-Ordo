import { redirect } from "next/navigation";
import { INVITABLE_ROLES, canInviteRole, listParishMembers, listPendingInvitations } from "@parvaordo/core";
import { isAdmin, ROLE_LABELS, type Role } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";
import { InviteForm } from "../invite-form";
import { removeMemberAction, renameMemberAction, revokeInvitationAction, setRoleAction } from "./actions";

// People — parish member management console (admin / super_admin).
export default async function PeoplePage() {
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const parishId = viewer?.identity?.parishId;
  const callerId = viewer?.identity?.userId;
  if (!parishId || !isAdmin(role)) redirect("/");

  const [members, pending] = await Promise.all([listParishMembers(parishId), listPendingInvitations()]);
  const pendingByEmail = new Map(pending.map((p) => [p.email.toLowerCase(), p.id]));
  const invitableRoles = INVITABLE_ROLES.filter((r) => canInviteRole(role, r)) as Role[];

  const selectClass =
    "rounded-md border border-gray-300 px-2 py-1 text-xs text-navy focus:border-gold focus:outline-none";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Administration</p>
        <h1 className="font-heading text-2xl text-navy">People</h1>
      </div>

      <InviteForm roles={invitableRoles} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-400">Members ({members.length})</h2>
        <ul className="space-y-2" data-testid="people-list">
          {members.map((m) => {
            const invitationId = pendingByEmail.get(m.email.toLowerCase());
            const isSelf = m.userId === callerId;
            return (
              <li
                key={`${m.userId}-${m.role}-${m.ministryName ?? ""}`}
                data-testid={`person-${m.email}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-navy">
                    {m.displayName}
                    {invitationId ? (
                      <span
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                        data-testid="pending-badge"
                      >
                        Pending
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-gray-500">
                    {m.email}
                    {m.ministryName ? ` · ${m.ministryName}` : ""}
                  </p>
                  <form action={renameMemberAction} className="mt-1 flex items-center gap-1">
                    <input type="hidden" name="userId" value={m.userId} />
                    <input
                      name="displayName"
                      defaultValue={m.displayName}
                      data-testid={`rename-input-${m.email}`}
                      className="w-40 rounded-md border border-gray-300 px-2 py-1 text-xs text-navy focus:border-gold focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Rename
                    </button>
                  </form>
                </div>

                <div className="flex items-center gap-2">
                  {isSelf ? (
                    <span className="rounded bg-navy/10 px-2 py-1 text-xs font-medium text-navy">
                      {ROLE_LABELS[m.role]} (you)
                    </span>
                  ) : (
                    <>
                      <form action={setRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={m.userId} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          className={selectClass}
                          data-testid={`role-select-${m.email}`}
                        >
                          {invitableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-gold bg-gold/10 px-2 py-1 text-xs font-medium text-gold-dark hover:bg-gold/20"
                        >
                          Update
                        </button>
                      </form>
                      {invitationId ? (
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="invitationId" value={invitationId} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <button
                            type="submit"
                            className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            title="Revoke invitation"
                          >
                            Revoke
                          </button>
                        </form>
                      ) : (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <button
                            type="submit"
                            data-testid={`remove-${m.email}`}
                            className="rounded-md border border-rose/40 px-2 py-1 text-xs font-medium text-rose hover:bg-rose/10"
                            title="Remove from parish"
                          >
                            Remove
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
