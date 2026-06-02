import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, listParishMembers, removeMember, setMemberName, setMemberRole } from "@parvaordo/core";

const HS = "11111111-1111-1111-1111-111111111111";
const EMAIL = "people-int@inttest.local";
let userId: string;

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
});

afterAll(async () => {
  await getDb(null).query("DELETE FROM users WHERE email = $1", [EMAIL]); // cascades membership
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

  it("removes a member from the parish", async () => {
    await removeMember(HS, userId);
    const m = await listParishMembers(HS);
    expect(m.find((x) => x.userId === userId)).toBeUndefined();
  });
});
