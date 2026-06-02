import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callYouthTool, closeDb, getDb } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

// po-7diw (RFC-001 §3.5): the Parvus Studio MCP tools are an entry point that touches a
// TOGGLEABLE module's data, so callYouthTool must reject when studio is disabled for the
// session's parish — not just hide nav. Resets the parish_modules row each test.
beforeEach(async () => {
  await getDb(HOLY_SPIRIT).query("DELETE FROM parish_modules WHERE module_key = 'studio'");
});

afterAll(async () => {
  await getDb(HOLY_SPIRIT).query("DELETE FROM parish_modules WHERE module_key = 'studio'");
  await closeDb();
});

describe("MCP studio enforcement — callYouthTool gates on module enablement (RFC-001 §3.5)", () => {
  it("rejects every tool call when Parvus Studio is disabled for the parish", async () => {
    const teen = await userId("admin@parvaordo.test");
    await getDb(HOLY_SPIRIT).query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'studio', false)",
      [HOLY_SPIRIT],
    );
    await expect(callYouthTool({ parishId: HOLY_SPIRIT, teenUserId: teen }, "list_my_projects", {})).rejects.toThrow(
      /not enabled/i,
    );
  });

  it("allows tool calls when Parvus Studio is enabled (sparse default — no row)", async () => {
    const teen = await userId("admin@parvaordo.test");
    await expect(
      callYouthTool({ parishId: HOLY_SPIRIT, teenUserId: teen }, "list_my_projects", {}),
    ).resolves.toBeDefined();
  });
});
