import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The DB chokepoint talks to `pg` directly. Mock the Pool so these stay unit-level:
// connect() hands back one fake client whose query() we script per test, letting us
// force a transaction error AND a failing ROLLBACK without a real database.
const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return { clientQuery, release, connect };
});

vi.mock("pg", () => ({ Pool: vi.fn(() => ({ connect: mocks.connect })) }));

import { getDb, withTenant } from "./client";

describe("db chokepoint — rollback failure observability (po-rt2)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test/db");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    errorSpy.mockRestore();
  });

  // REGRESSION (po-rt2): a failing ROLLBACK was swallowed by `.catch(() => {})`, so a
  // connection released back to the pool stuck mid-transaction left no trace. The
  // rollback error must now be logged — while the ORIGINAL error is still what callers
  // see (we must not mask the real failure with rollback noise).
  it("logs the rollback error and rethrows the ORIGINAL error when ROLLBACK fails (getDb)", async () => {
    const originalErr = new Error("insert blew up");
    const rollbackErr = new Error("connection reset during ROLLBACK");
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw rollbackErr;
      if (sql === "SELECT 1") throw originalErr;
      return { rows: [] }; // BEGIN / set_config
    });

    await expect(getDb(null).query("SELECT 1")).rejects.toBe(originalErr);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toContain(rollbackErr);
    // the connection is still returned to the pool even when rollback fails
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  // A normal failure where ROLLBACK succeeds must stay quiet — we only want a log line
  // for the genuinely abnormal case (rollback itself failing), not for every error.
  it("does NOT log when ROLLBACK succeeds after a query error (getDb)", async () => {
    const originalErr = new Error("constraint violation");
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "SELECT 1") throw originalErr;
      return { rows: [] }; // BEGIN / ROLLBACK both succeed
    });

    await expect(getDb(null).query("SELECT 1")).rejects.toBe(originalErr);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("returns rows and logs nothing on the happy path (getDb)", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "SELECT 1") return { rows: [{ id: "x" }] };
      return { rows: [] };
    });

    const out = await getDb("parish-1").query("SELECT 1");
    expect(out).toEqual({ rows: [{ id: "x" }] });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Same contract for the multi-statement transaction wrapper.
  it("logs the rollback error and rethrows the ORIGINAL error when ROLLBACK fails (withTenant)", async () => {
    const originalErr = new Error("fn threw mid-transaction");
    const rollbackErr = new Error("pool dead during ROLLBACK");
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw rollbackErr;
      return { rows: [] }; // BEGIN / set_config
    });

    await expect(
      withTenant("parish-1", async () => {
        throw originalErr;
      }),
    ).rejects.toBe(originalErr);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toContain(rollbackErr);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("does NOT log when ROLLBACK succeeds after a transaction error (withTenant)", async () => {
    const originalErr = new Error("fn threw mid-transaction");
    mocks.clientQuery.mockImplementation(async () => ({ rows: [] }));

    await expect(
      withTenant("parish-1", async () => {
        throw originalErr;
      }),
    ).rejects.toBe(originalErr);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
