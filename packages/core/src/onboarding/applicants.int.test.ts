import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createOciaApplicant,
  dismissApplicant,
  getDb,
  inviteApplicantAsStudent,
  listOciaApplicants,
  lookupAppUser,
  setApplicationsEnabled,
} from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";

const HS = "11111111-1111-1111-1111-111111111111";
const SM = "22222222-2222-2222-2222-222222222222";
const TEST_LIKE = "%@applicanttest.local";

let admin: { userId: string; role: Role | null; parishId: string };

beforeAll(async () => {
  delete process.env.WORKOS_API_KEY;
  const a = await lookupAppUser("admin@parvaordo.test");
  admin = { userId: a!.userId, role: a!.role, parishId: a!.parishId! };
  await setApplicationsEnabled(HS, true);
});

afterAll(async () => {
  await setApplicationsEnabled(HS, false); // restore the seed default
  await getDb(HS).query("DELETE FROM ocia_applicants WHERE email LIKE $1", [TEST_LIKE]);
  await getDb(null).query("DELETE FROM users WHERE email LIKE $1", [TEST_LIKE]);
  await closeDb();
});

describe("ocia applicants (integration)", () => {
  it("creates a pending applicant when applications are open, and lists it", async () => {
    const { id } = await createOciaApplicant({
      parishId: HS,
      email: "alice@applicanttest.local",
      fullName: "Alice A",
      formData: { baptized: "no" },
    });
    const list = await listOciaApplicants(HS, { status: "pending" });
    const found = list.find((a) => a.id === id);
    expect(found?.email).toBe("alice@applicanttest.local");
    expect(found?.formData).toMatchObject({ baptized: "no" });
  });

  it("rejects submissions when applications are closed", async () => {
    await setApplicationsEnabled(HS, false);
    await expect(
      createOciaApplicant({ parishId: HS, email: "blocked@applicanttest.local", fullName: "Blocked B" }),
    ).rejects.toThrow(/not open/);
    await setApplicationsEnabled(HS, true);
  });

  it("throttles a rapid resubmit from the same email", async () => {
    const email = "rapid@applicanttest.local";
    await createOciaApplicant({ parishId: HS, email, fullName: "Rapid R" });
    await expect(createOciaApplicant({ parishId: HS, email, fullName: "Rapid R" })).rejects.toThrow(/already received/);
  });

  it("converts an applicant to an invited catechumen/candidate (membership created)", async () => {
    const { id } = await createOciaApplicant({ parishId: HS, email: "carol@applicanttest.local", fullName: "Carol C" });
    await inviteApplicantAsStudent(HS, id, admin);
    const list = await listOciaApplicants(HS);
    expect(list.find((a) => a.id === id)?.status).toBe("invited");
    const { rows } = await getDb(HS).query<{ role: string }>(
      "SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.parish_id = $2",
      ["carol@applicanttest.local", HS],
    );
    expect(rows.map((r) => r.role)).toContain("catechumen_candidate");
  });

  it("isolates applicants by parish (RLS): an HS applicant is invisible under St. Monica", async () => {
    const { id } = await createOciaApplicant({ parishId: HS, email: "iso@applicanttest.local", fullName: "Iso I" });
    const smList = await listOciaApplicants(SM);
    expect(smList.find((a) => a.id === id)).toBeUndefined();
  });

  it("dismisses a pending applicant", async () => {
    const { id } = await createOciaApplicant({ parishId: HS, email: "dave@applicanttest.local", fullName: "Dave D" });
    await dismissApplicant(HS, id, admin.userId);
    const list = await listOciaApplicants(HS);
    expect(list.find((a) => a.id === id)?.status).toBe("dismissed");
  });
});
