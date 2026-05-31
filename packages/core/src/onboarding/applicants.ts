import { getDb } from "../db/client";
import { type InviteCaller, type InviteResult, inviteMember } from "./invite";

export interface OciaApplicant {
  id: string;
  email: string;
  fullName: string;
  formData: Record<string, unknown>;
  status: "pending" | "invited" | "dismissed";
  submittedAt: string;
  reviewedAt: string | null;
}

interface ApplicantRow {
  id: string;
  email: string;
  full_name: string;
  form_data: Record<string, unknown>;
  status: OciaApplicant["status"];
  submitted_at: string;
  reviewed_at: string | null;
}

const mapApplicant = (r: ApplicantRow): OciaApplicant => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  formData: r.form_data,
  status: r.status,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at,
});

/**
 * Create a public OCIA application (a lead, not an account). Parish is resolved
 * from the request tenant by the caller; RLS pins the row to it. Server-side this
 * enforces the per-parish applications toggle and a simple resubmit throttle —
 * the public-form abuse vectors Narthex left open.
 */
export async function createOciaApplicant(input: {
  parishId: string;
  email: string;
  fullName: string;
  formData?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email.includes("@")) throw new Error("a valid email is required");
  if (!fullName) throw new Error("your name is required");

  const db = getDb(input.parishId);
  const parish = await db.query<{ applications_enabled: boolean }>(
    "SELECT applications_enabled FROM parishes WHERE id = $1",
    [input.parishId],
  );
  if (!parish.rows[0]?.applications_enabled) {
    throw new Error("applications are not open for this parish");
  }
  // Basic throttle: one submission per email/parish per minute.
  const recent = await db.query(
    "SELECT 1 FROM ocia_applicants WHERE lower(email) = $1 AND submitted_at > now() - interval '60 seconds' LIMIT 1",
    [email],
  );
  if (recent.rows.length) {
    throw new Error("we already received your application — please wait a moment before resubmitting");
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ocia_applicants (parish_id, email, full_name, form_data)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [input.parishId, email, fullName, JSON.stringify(input.formData ?? {})],
  );
  return { id: rows[0]!.id };
}

/** List a parish's applicants (newest first), excluding soft-deleted. RLS pins to parish. */
export async function listOciaApplicants(
  parishId: string,
  opts: { status?: OciaApplicant["status"] } = {},
): Promise<OciaApplicant[]> {
  const { rows } = await getDb(parishId).query<ApplicantRow>(
    `SELECT id, email, full_name, form_data, status, submitted_at, reviewed_at
       FROM ocia_applicants
      WHERE deleted_at IS NULL ${opts.status ? "AND status = $1" : ""}
      ORDER BY submitted_at DESC`,
    opts.status ? [opts.status] : [],
  );
  return rows.map(mapApplicant);
}

/** Convert a pending applicant into an invited catechumen/candidate (reuses inviteMember). */
export async function inviteApplicantAsStudent(
  parishId: string,
  applicantId: string,
  caller: InviteCaller,
): Promise<InviteResult> {
  const { rows } = await getDb(parishId).query<{ email: string; full_name: string }>(
    "SELECT email, full_name FROM ocia_applicants WHERE id = $1 AND deleted_at IS NULL",
    [applicantId],
  );
  const applicant = rows[0];
  if (!applicant) throw new Error("applicant not found");

  const result = await inviteMember(
    { email: applicant.email, fullName: applicant.full_name, role: "catechumen_candidate" },
    caller,
  );
  await getDb(parishId).query(
    "UPDATE ocia_applicants SET status = 'invited', reviewed_at = now(), reviewed_by = $2 WHERE id = $1",
    [applicantId, caller.userId],
  );
  return result;
}

/** Dismiss a pending applicant (no invite). */
export async function dismissApplicant(parishId: string, applicantId: string, reviewerId: string): Promise<void> {
  await getDb(parishId).query(
    "UPDATE ocia_applicants SET status = 'dismissed', reviewed_at = now(), reviewed_by = $2 WHERE id = $1",
    [applicantId, reviewerId],
  );
}

/** Soft-delete an applicant (hidden from the queue). */
export async function softDeleteApplicant(parishId: string, applicantId: string): Promise<void> {
  await getDb(parishId).query("UPDATE ocia_applicants SET deleted_at = now() WHERE id = $1", [applicantId]);
}

/** Parish name + whether public applications are open (for the /apply page). */
export async function getParishApplyInfo(
  parishId: string,
): Promise<{ name: string; applicationsEnabled: boolean } | null> {
  const { rows } = await getDb(parishId).query<{ name: string; applications_enabled: boolean }>(
    "SELECT name, applications_enabled FROM parishes WHERE id = $1",
    [parishId],
  );
  const r = rows[0];
  return r ? { name: r.name, applicationsEnabled: r.applications_enabled } : null;
}

/** Parishes accepting public applications — the /apply picker on the apex. Cross-tenant. */
export async function listApplicationParishes(): Promise<{ id: string; name: string; slug: string }[]> {
  const { rows } = await getDb(null).query<{ id: string; name: string; slug: string }>(
    "SELECT id, name, slug FROM list_application_parishes()",
  );
  return rows;
}

/** Open or close public applications for a parish (admin only — enforced in the action). */
export async function setApplicationsEnabled(parishId: string, enabled: boolean): Promise<void> {
  await getDb(parishId).query("UPDATE parishes SET applications_enabled = $2 WHERE id = $1", [parishId, enabled]);
}
