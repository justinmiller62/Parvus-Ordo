import { redirect } from "next/navigation";
import { canInviteRole, getParishApplyInfo, listOciaApplicants, INVITABLE_ROLES } from "@parvaordo/core";
import { isStaff, type Role } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";
import { InviteForm } from "./invite-form";
import {
  convertApplicantAction,
  deleteApplicantAction,
  dismissApplicantAction,
  toggleApplicationsAction,
} from "./actions";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-gold/15 text-gold-dark",
  invited: "bg-green-100 text-green-700",
  dismissed: "bg-gray-100 text-gray-500",
};

export default async function ApplicantsPage() {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  if (!parishId || !isStaff(role)) redirect("/ocia");

  const [applicants, info] = await Promise.all([listOciaApplicants(parishId), getParishApplyInfo(parishId)]);
  const invitableRoles = INVITABLE_ROLES.filter((r) => canInviteRole(role ?? null, r)) as Role[];
  const isAdmin = role === "admin" || role === "super_admin";
  const applicationsOpen = info?.applicationsEnabled ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-navy">Applicants &amp; invitations</h1>
          <p className="text-sm text-gray-500">Review OCIA inquiries and invite people to the parish.</p>
        </div>
        {isAdmin ? (
          <form action={toggleApplicationsAction.bind(null, !applicationsOpen)}>
            <button
              type="submit"
              data-testid="toggle-applications"
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                applicationsOpen
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              Public applications: {applicationsOpen ? "Open" : "Closed"}
            </button>
          </form>
        ) : null}
      </div>

      <InviteForm roles={invitableRoles} />

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-navy">
          Applications ({applicants.length})
        </div>
        {applicants.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400" data-testid="applicants-empty">
            No applications yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="applicants-list">
            {applicants.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy">
                    {a.fullName}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[a.status] ?? ""}`}>
                      {a.status}
                    </span>
                  </p>
                  <p className="truncate text-xs text-gray-400">{a.email}</p>
                </div>
                {a.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <form action={convertApplicantAction.bind(null, a.id)}>
                      <button
                        type="submit"
                        data-testid={`convert-${a.id}`}
                        className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-white hover:bg-gold-dark"
                      >
                        Invite as student
                      </button>
                    </form>
                    <form action={dismissApplicantAction.bind(null, a.id)}>
                      <button
                        type="submit"
                        data-testid={`dismiss-${a.id}`}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Dismiss
                      </button>
                    </form>
                  </div>
                ) : (
                  <form action={deleteApplicantAction.bind(null, a.id)}>
                    <button
                      type="submit"
                      data-testid={`delete-${a.id}`}
                      className="text-xs text-gray-400 hover:text-rose"
                    >
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
