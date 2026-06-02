import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, lookupAppUser } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

afterAll(async () => {
  await closeDb();
});

describe("lookupAppUser (login_lookup, integration)", () => {
  it("resolves a seeded admin to role + parish", async () => {
    const id = await lookupAppUser("admin@parvaordo.test");
    expect(id?.role).toBe("admin");
    expect(id?.parishId).toBe(HOLY_SPIRIT);
  });

  it("is case-insensitive on email", async () => {
    const id = await lookupAppUser("ADMIN@parvaordo.test");
    expect(id?.role).toBe("admin");
  });

  it("resolves the ministry-scoped catechist to catechist + parish", async () => {
    const id = await lookupAppUser("teacher@parvaordo.test");
    expect(id?.role).toBe("catechist");
    expect(id?.parishId).toBe(HOLY_SPIRIT);
  });

  it("returns null for an unknown email", async () => {
    expect(await lookupAppUser("nobody@example.com")).toBeNull();
  });
});

// po-r05: the cases above only prove case-INSENSITIVE LOOKUP (which predates this
// change). This block pins the NEW observable behaviour added by migration 0024 —
// case-INSENSITIVE UNIQUENESS — so a future index drop or expression change fails
// loudly. The case-sensitive users_email_key alone would NOT reject a case variant,
// so a rejection here can only come from users_email_lower_idx.
describe("users(lower(email)) unique index (po-r05, integration)", () => {
  const EMAIL = "caseuniq@parvaordo.test";

  afterAll(async () => {
    await getDb(null).query("DELETE FROM users WHERE lower(email) = lower($1)", [EMAIL]);
  });

  it("rejects a case-variant duplicate email via users_email_lower_idx", async () => {
    await getDb(null).query(
      "INSERT INTO users (email, display_name) VALUES ($1, 'Case Uniq') ON CONFLICT (email) DO NOTHING",
      [EMAIL],
    );

    let err: { code?: string; constraint?: string } | undefined;
    try {
      await getDb(null).query("INSERT INTO users (email, display_name) VALUES ($1, 'Case Variant')", [
        EMAIL.toUpperCase(),
      ]);
    } catch (e) {
      err = e as { code?: string; constraint?: string };
    }
    expect(err?.code).toBe("23505"); // unique_violation
    expect(err?.constraint).toBe("users_email_lower_idx"); // the new lower(email) index, not users_email_key

    // the rejected insert must not have landed — exactly one row for this identity
    const { rows } = await getDb(null).query<{ n: string }>(
      "SELECT count(*)::int AS n FROM users WHERE lower(email) = lower($1)",
      [EMAIL],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
