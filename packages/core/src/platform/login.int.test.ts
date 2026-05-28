import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, lookupAppUser } from "@parvaordo/core";

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
