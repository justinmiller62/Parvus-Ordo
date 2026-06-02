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

// Cross-parish isolation (the multi-tenant invariant that must never regress): the
// console mutations are parish-scoped — setMemberRole and removeMember key on
// (user_id, parish_id), and setMemberName has NO parish_id in its WHERE at all, relying
// entirely on RLS to scope its `memberships` EXISTS check to the acting parish. An admin
// acting in parish A must be a no-op against a user who belongs only to parish B. Seed a
// user in ST_MONICA only, fire every mutation with parishId=HS, and assert ST_MONICA is
// untouched. A regression (dropped parish_id key or RLS bypass) flips these to failures.
describe("people (integration) — cross-parish isolation", () => {
  const ST_MONICA = "22222222-2222-2222-2222-222222222222";
  const XEMAIL = "people-xtenant-int@inttest.local";
  const SEED_NAME = "St Monica Only";
  let stMonicaUserId: string;

  beforeAll(async () => {
    const u = await getDb(null).query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = $2 RETURNING id",
      [XEMAIL, SEED_NAME],
    );
    stMonicaUserId = u.rows[0]!.id;
    // Seed the membership in ST_MONICA only (under its own tenant context).
    await getDb(ST_MONICA).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [
      stMonicaUserId,
      ST_MONICA,
    ]);
    await getDb(ST_MONICA).query(
      "INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'parish_member')",
      [stMonicaUserId, ST_MONICA],
    );
  });

  afterAll(async () => {
    await getDb(null).query("DELETE FROM users WHERE email = $1", [XEMAIL]); // cascades membership
  });

  // The ST_MONICA-side view of the seeded user (read under ST_MONICA's tenant context).
  const stMonicaMember = async () => (await listParishMembers(ST_MONICA)).find((x) => x.userId === stMonicaUserId);

  it("setMemberRole from the wrong parish (HS) leaves the ST_MONICA role unchanged", async () => {
    await setMemberRole(HS, stMonicaUserId, "studio");
    expect((await stMonicaMember())?.role).toBe("parish_member");
  });

  it("setMemberName from the wrong parish (HS) does not rename the ST_MONICA member", async () => {
    // setMemberName writes the global users row gated only by an RLS-scoped EXISTS — this
    // pins that the acting parish (HS) cannot satisfy it for a foreign member.
    await setMemberName(HS, stMonicaUserId, "XTenant Overwrite");
    expect((await stMonicaMember())?.displayName).toBe(SEED_NAME);
  });

  it("removeMember from the wrong parish (HS) leaves the ST_MONICA membership intact", async () => {
    await removeMember(HS, stMonicaUserId);
    const m = await stMonicaMember();
    expect(m).toBeDefined();
    expect(m?.role).toBe("parish_member");
  });
});
