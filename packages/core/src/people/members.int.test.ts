import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, listParishMembers, removeMember, setMemberName, setMemberRole } from "@parvaordo/core";

const HS = "11111111-1111-1111-1111-111111111111";
const MONICA = "22222222-2222-2222-2222-222222222222"; // a different parish, for the cross-tenant guard
const EMAIL = "people-int@inttest.local";
const XEMAIL = "xtenant-int@inttest.local";
let userId: string;
let xUserId: string; // member of St. Monica only — never of Holy Spirit

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

  const x = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Original Name') ON CONFLICT (email) DO UPDATE SET display_name = 'Original Name' RETURNING id",
    [XEMAIL],
  );
  xUserId = x.rows[0]!.id;
  await getDb(MONICA).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [xUserId, MONICA]);
  await getDb(MONICA).query("INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'parish_member')", [
    xUserId,
    MONICA,
  ]);
});

afterAll(async () => {
  await getDb(null).query("DELETE FROM users WHERE email = ANY($1)", [[EMAIL, XEMAIL]]); // cascades memberships
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

// setMemberName writes the GLOBAL users row, so its parish guard must be self-contained:
// renaming is allowed ONLY for a member of the parish the caller is acting in. Pin that
// cross-tenant contract so it can't silently regress (po-73w).
describe("setMemberName parish guard (integration)", () => {
  it("does not rename a user who belongs only to a different parish", async () => {
    // xUser is a member of St. Monica, not Holy Spirit. Acting as Holy Spirit is a no-op.
    await setMemberName(HS, xUserId, "Renamed By Holy Spirit");
    const monica = await listParishMembers(MONICA);
    expect(monica.find((m) => m.userId === xUserId)?.displayName).toBe("Original Name");
  });

  it("renames the user from their own parish", async () => {
    await setMemberName(MONICA, xUserId, "Renamed By St Monica");
    const monica = await listParishMembers(MONICA);
    expect(monica.find((m) => m.userId === xUserId)?.displayName).toBe("Renamed By St Monica");
  });
});
