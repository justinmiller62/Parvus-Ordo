import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, listParishMembers, removeMember, setMemberName, setMemberRole } from "@parvaordo/core";

const HS = "11111111-1111-1111-1111-111111111111";
const EMAIL = "people-int@inttest.local";
// A user with NO membership in HS — used to prove setMemberName's parish guard.
const NON_MEMBER_EMAIL = "people-int-nonmember@inttest.local";
let userId: string;
let nonMemberId: string;

beforeAll(async () => {
  const u = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'People Int') ON CONFLICT (email) DO UPDATE SET display_name = 'People Int' RETURNING id",
    [EMAIL],
  );
  userId = u.rows[0]!.id;
  await getDb(HS).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [userId, HS]);
  await getDb(HS).query("INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'parish_member')", [
    userId,
    HS,
  ]);

  const n = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Outsider Name') ON CONFLICT (email) DO UPDATE SET display_name = 'Outsider Name' RETURNING id",
    [NON_MEMBER_EMAIL],
  );
  nonMemberId = n.rows[0]!.id;
  await getDb(HS).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [nonMemberId, HS]);
});

afterAll(async () => {
  await getDb(null).query("DELETE FROM users WHERE email = ANY($1)", [[EMAIL, NON_MEMBER_EMAIL]]); // cascades membership
  await closeDb();
});

describe("people (integration)", () => {
  it("lists the parish member with email + role", async () => {
    const m = await listParishMembers(HS);
    const row = m.find((x) => x.userId === userId);
    expect(row?.email).toBe(EMAIL);
    expect(row?.role).toBe("parish_member");
  });

  it("changes a member's role", async () => {
    await setMemberRole(HS, userId, "studio");
    const m = await listParishMembers(HS);
    expect(m.find((x) => x.userId === userId)?.role).toBe("studio");
  });

  it("renames a member", async () => {
    await setMemberName(HS, userId, "Renamed Person");
    const m = await listParishMembers(HS);
    expect(m.find((x) => x.userId === userId)?.displayName).toBe("Renamed Person");
  });

  it("will not rename a user who is not a member of this parish (parish guard)", async () => {
    await setMemberName(HS, nonMemberId, "Hijacked Name");
    // Untouched: the outsider is not in the parish list and keeps their global name.
    const m = await listParishMembers(HS);
    expect(m.find((x) => x.userId === nonMemberId)).toBeUndefined();
    const { rows } = await getDb(null).query<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [
      nonMemberId,
    ]);
    expect(rows[0]?.display_name).toBe("Outsider Name");
  });

  it("removes a member from the parish", async () => {
    await removeMember(HS, userId);
    const m = await listParishMembers(HS);
    expect(m.find((x) => x.userId === userId)).toBeUndefined();
  });
});
