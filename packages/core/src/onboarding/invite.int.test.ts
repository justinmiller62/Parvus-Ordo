import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, inviteMember, lookupAppUser } from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";

const HS = "11111111-1111-1111-1111-111111111111";
const TEST_LIKE = "%@invitetest.local";

interface Caller {
  userId: string;
  role: Role | null;
  parishId: string;
}
let admin: Caller;
let catechist: Caller;

beforeAll(async () => {
  // Force the invitation stub — never hit the real WorkOS API from a test.
  delete process.env.WORKOS_API_KEY;
  const a = await lookupAppUser("admin@parvaordo.test");
  const c = await lookupAppUser("teacher@parvaordo.test");
  admin = { userId: a!.userId, role: a!.role, parishId: a!.parishId! };
  catechist = { userId: c!.userId, role: c!.role, parishId: c!.parishId! };
});

afterAll(async () => {
  // Deleting the users cascades their memberships (FK ON DELETE CASCADE).
  await getDb(null).query("DELETE FROM users WHERE email LIKE $1", [TEST_LIKE]);
  await closeDb();
});

describe("inviteMember (integration)", () => {
  it("invites a new person: creates the user + membership; no email without a WorkOS key", async () => {
    const r = await inviteMember({ email: "newbie@invitetest.local", role: "catechumen_candidate" }, admin);
    expect(r.isNewUser).toBe(true);
    expect(r.invitationSent).toBe(false);
    const { rows } = await getDb(HS).query<{ role: string }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND parish_id = $2",
      [r.userId, HS],
    );
    expect(rows.map((x) => x.role)).toContain("catechumen_candidate");
  });

  it("dedupes the same (email, parish, role) → conflict", async () => {
    await inviteMember({ email: "dupe@invitetest.local", role: "catechumen_candidate" }, admin);
    await expect(
      inviteMember({ email: "dupe@invitetest.local", role: "catechumen_candidate" }, admin),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a catechist may NOT mint an admin → forbidden", async () => {
    await expect(inviteMember({ email: "boss@invitetest.local", role: "admin" }, catechist)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("a catechist may invite a catechumen/candidate", async () => {
    const r = await inviteMember({ email: "learner@invitetest.local", role: "catechumen_candidate" }, catechist);
    expect(r.isNewUser).toBe(true);
  });

  it("rejects a malformed email", async () => {
    await expect(inviteMember({ email: "not-an-email", role: "catechumen_candidate" }, admin)).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
