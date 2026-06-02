import { describe, expect, it } from "vitest";
import { assertSeeded, requireIntegrationEnv } from "./int-guard";

// po-99f: the integration suite (*.int.test.ts) used to depend on a live Postgres
// with no guard, so a missing DATABASE_URL produced a wall of per-test connection
// errors and an empty/unseeded DB could pass green. These pure helpers back the
// integration globalSetup (vitest.int.setup.ts) and are unit-tested here so the
// fail-fast behaviour is verified without needing a database.

describe("requireIntegrationEnv", () => {
  const PRESENT = {
    DATABASE_URL: "postgres://app@localhost/db",
    MIGRATION_DATABASE_URL: "postgres://postgres@localhost/db",
  };

  it("returns both URLs when present", () => {
    expect(requireIntegrationEnv(PRESENT)).toEqual({
      databaseUrl: "postgres://app@localhost/db",
      migrationUrl: "postgres://postgres@localhost/db",
    });
  });

  it("throws naming DATABASE_URL when only it is missing", () => {
    expect(() => requireIntegrationEnv({ MIGRATION_DATABASE_URL: PRESENT.MIGRATION_DATABASE_URL })).toThrow(
      /DATABASE_URL/,
    );
    // The actionable fix is part of the message so the failure is self-explanatory.
    expect(() => requireIntegrationEnv({ MIGRATION_DATABASE_URL: PRESENT.MIGRATION_DATABASE_URL })).toThrow(/\.env/);
  });

  it("throws naming MIGRATION_DATABASE_URL when only it is missing", () => {
    expect(() => requireIntegrationEnv({ DATABASE_URL: PRESENT.DATABASE_URL })).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("throws naming BOTH vars when both are missing", () => {
    const run = (): unknown => requireIntegrationEnv({});
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).toThrow(/MIGRATION_DATABASE_URL/);
  });

  // An empty or whitespace-only value is as good as unset — a common .env footgun
  // (e.g. `DATABASE_URL=`) that must not slip past the guard.
  it("treats empty and whitespace-only values as missing", () => {
    expect(() => requireIntegrationEnv({ ...PRESENT, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
    expect(() => requireIntegrationEnv({ ...PRESENT, DATABASE_URL: "   " })).toThrow(/DATABASE_URL/);
  });
});

describe("assertSeeded", () => {
  it("passes when at least one seed row is present", () => {
    expect(() => assertSeeded(2)).not.toThrow();
  });

  // The core of the bug this bead fixes: a connected-but-empty DB must fail loudly
  // rather than appear green. Zero rows is the tell.
  it("throws loudly when the DB is reachable but unseeded (zero rows)", () => {
    expect(() => assertSeeded(0)).toThrow(/seed/i);
    expect(() => assertSeeded(0)).toThrow(/db:seed|db:reset/);
  });

  it("throws on a non-finite count (a malformed query result)", () => {
    expect(() => assertSeeded(Number.NaN)).toThrow();
    expect(() => assertSeeded(-1)).toThrow();
  });
});
