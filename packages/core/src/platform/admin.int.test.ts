import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminError,
  closeDb,
  getParishStats,
  inviteFirstAdmin,
  listParishes,
  provisionParish,
  setCustomDomains,
  setDioceseModuleDefault,
  setModuleEnabled,
  setParishBrand,
  setParishStatus,
  setParishSubdomain,
  writeAdminAudit,
} from "@parvaordo/core";

// Integration coverage for the super-admin admin plane (RFC-004 §3/§5/§6/§10/§12). Verifies the
// THREE acceptance pillars — super-admin re-assert, DEFINER routing, audit-per-write — plus
// bare-shell provisioning, slug/domain/module/status validation, and first-admin invite. The
// admin_audit table is RLS-locked + grant-revoked, so a superuser connection reads it + cleans up.

const DIOCESE_AJ = "00000000-0000-0000-0000-000000000001";
const SLUG_PREFIX = "test-ug00";
const INVITE_EMAIL_PREFIX = "firstadmin-ug00";
const UNKNOWN_PARISH = "99999999-9999-9999-9999-999999999999";

let su: Client;
let superId: string; // super@parvaordo.test (is_super_admin = true)
let adminId: string; // admin@parvaordo.test (a parish admin — NOT a super-admin)
let n = 0;

async function uid(email: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

/** Provision a fresh, uniquely-slugged shell so each mutating test starts from a known state. */
async function freshParish(label = "p"): Promise<string> {
  n += 1;
  return provisionParish(superId, {
    name: `UG00 ${label}`,
    slug: `${SLUG_PREFIX}-${label}-${n}`,
    dioceseId: DIOCESE_AJ,
  });
}

async function auditCount(parishId: string, action: string): Promise<number> {
  const { rows } = await su.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM admin_audit WHERE target_parish_id = $1 AND action = $2",
    [parishId, action],
  );
  return rows[0]!.c;
}

/** Assert a thunk rejects with an AdminError of the given code (not a raw pg error). */
async function expectAdminError(run: () => Promise<unknown>, code: AdminError["code"]): Promise<void> {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, "expected an AdminError to be thrown").toBeInstanceOf(AdminError);
  expect((err as AdminError).code).toBe(code);
}

async function cleanup(): Promise<void> {
  await su.query("DELETE FROM admin_audit WHERE target_parish_id IN (SELECT id FROM parishes WHERE slug LIKE $1)", [
    `${SLUG_PREFIX}-%`,
  ]);
  await su.query("DELETE FROM admin_audit WHERE action = 'set_diocese_module_default' AND detail->>'diocese_id' = $1", [
    DIOCESE_AJ,
  ]);
  await su.query("DELETE FROM diocese_modules WHERE diocese_id = $1 AND module_key IN ('ocia', 'studio')", [
    DIOCESE_AJ,
  ]);
  await su.query("DELETE FROM parishes WHERE slug LIKE $1", [`${SLUG_PREFIX}-%`]); // cascades memberships + parish_modules
  await su.query("DELETE FROM users WHERE email LIKE $1", [`${INVITE_EMAIL_PREFIX}%`]);
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  superId = await uid("super@parvaordo.test");
  adminId = await uid("admin@parvaordo.test");
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("admin plane — super-admin re-assert (the core authorization gate)", () => {
  it("rejects a non-super-admin actor on EVERY entry point with forbidden", async () => {
    const input = { name: "Nope", slug: `${SLUG_PREFIX}-forbidden-x`, dioceseId: DIOCESE_AJ };
    await expectAdminError(() => provisionParish(adminId, input), "forbidden");
    await expectAdminError(() => listParishes(adminId), "forbidden");
    await expectAdminError(() => getParishStats(adminId, UNKNOWN_PARISH), "forbidden");
    await expectAdminError(() => setParishStatus(adminId, UNKNOWN_PARISH, "active"), "forbidden");
    await expectAdminError(() => setParishSubdomain(adminId, UNKNOWN_PARISH, "anything-here"), "forbidden");
    await expectAdminError(() => setCustomDomains(adminId, UNKNOWN_PARISH, ["x.example.com"]), "forbidden");
    await expectAdminError(() => setModuleEnabled(adminId, UNKNOWN_PARISH, "ocia", false), "forbidden");
    await expectAdminError(() => setDioceseModuleDefault(adminId, DIOCESE_AJ, "ocia", false), "forbidden");
    await expectAdminError(() => setParishBrand(adminId, UNKNOWN_PARISH, { v: 1 }), "forbidden");
    await expectAdminError(() => inviteFirstAdmin(adminId, UNKNOWN_PARISH, "x@y.test"), "forbidden");
    await expectAdminError(() => writeAdminAudit(adminId, "spoof", UNKNOWN_PARISH, {}), "forbidden");
  });

  it("rejects an unknown actor id (fail-closed) with forbidden", async () => {
    await expectAdminError(() => listParishes(UNKNOWN_PARISH), "forbidden");
  });
});

describe("admin plane — provisioning (bare shell + audit)", () => {
  it("provisionParish makes a bare shell (pending_setup, 0 members/ministries) and audits", async () => {
    const pid = await freshParish("bare");
    const stats = await getParishStats(superId, pid);
    expect(stats).not.toBeNull();
    expect(stats!.status).toBe("pending_setup");
    expect(stats!.memberCount).toBe(0);
    expect(stats!.ministryCount).toBe(0);
    expect(await auditCount(pid, "create_parish")).toBe(1);
  });

  it("provisionParish rejects an invalid slug before any DB write (invalid)", async () => {
    await expectAdminError(
      () => provisionParish(superId, { name: "Bad", slug: "WWW", dioceseId: DIOCESE_AJ }),
      "invalid",
    );
    await expectAdminError(
      () => provisionParish(superId, { name: "Bad", slug: "ab", dioceseId: DIOCESE_AJ }),
      "invalid",
    );
    await expectAdminError(
      () => provisionParish(superId, { name: "", slug: `${SLUG_PREFIX}-noname-1`, dioceseId: DIOCESE_AJ }),
      "invalid",
    );
  });

  it("provisionParish rejects a duplicate slug as conflict (global uniqueness)", async () => {
    const slug = `${SLUG_PREFIX}-dupe-${(n += 1)}`;
    await provisionParish(superId, { name: "First", slug, dioceseId: DIOCESE_AJ });
    await expectAdminError(() => provisionParish(superId, { name: "Second", slug, dioceseId: DIOCESE_AJ }), "conflict");
  });

  it("listParishes returns the cross-tenant set including a freshly-provisioned parish", async () => {
    const pid = await freshParish("listed");
    const all = await listParishes(superId);
    const found = all.find((p) => p.id === pid);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending_setup");
    expect(found!.slug).toContain(`${SLUG_PREFIX}-listed`);
  });

  it("getParishStats returns null for an unknown parish", async () => {
    expect(await getParishStats(superId, UNKNOWN_PARISH)).toBeNull();
  });
});

describe("admin plane — lifecycle status (transition enforcement + audit)", () => {
  it("advances pending_setup → active and audits", async () => {
    const pid = await freshParish("life");
    await setParishStatus(superId, pid, "active");
    expect((await getParishStats(superId, pid))!.status).toBe("active");
    expect(await auditCount(pid, "set_status")).toBe(1);
  });

  it("rejects an illegal transition (active → pending_setup) as invalid without writing", async () => {
    const pid = await freshParish("life2");
    await setParishStatus(superId, pid, "active");
    await expectAdminError(() => setParishStatus(superId, pid, "pending_setup"), "invalid");
    expect((await getParishStats(superId, pid))!.status).toBe("active"); // unchanged
  });

  it("rejects setting status on an unknown parish as not_found", async () => {
    await expectAdminError(() => setParishStatus(superId, UNKNOWN_PARISH, "suspended"), "not_found");
  });
});

describe("admin plane — subdomain + custom domains", () => {
  it("setParishSubdomain rejects reserved/invalid slugs and updates a valid one", async () => {
    const pid = await freshParish("sub");
    await expectAdminError(() => setParishSubdomain(superId, pid, "www"), "invalid");
    const newSlug = `${SLUG_PREFIX}-sub-renamed-${(n += 1)}`;
    await setParishSubdomain(superId, pid, newSlug);
    expect((await listParishes(superId)).find((p) => p.id === pid)!.slug).toBe(newSlug);
    expect(await auditCount(pid, "set_parish_subdomain")).toBe(1);
  });

  it("setParishSubdomain rejects a slug another parish already owns as conflict", async () => {
    const a = await freshParish("sub-a");
    const taken = (await listParishes(superId)).find((p) => p.id === a)!.slug;
    const b = await freshParish("sub-b");
    await expectAdminError(() => setParishSubdomain(superId, b, taken), "conflict");
  });

  it("setCustomDomains rejects a malformed hostname (invalid) and persists valid ones with audit", async () => {
    const pid = await freshParish("dom");
    await expectAdminError(() => setCustomDomains(superId, pid, ["not a host"]), "invalid");
    await setCustomDomains(superId, pid, ["Parish.Example.COM", "alt.example.org"]);
    const { rows } = await su.query<{ custom_domains: string[] }>("SELECT custom_domains FROM parishes WHERE id = $1", [
      pid,
    ]);
    // The DEFINER stores array_agg(DISTINCT lower(d)) — lowercased + deduped, sorted by value.
    expect([...rows[0]!.custom_domains].sort()).toEqual(["alt.example.org", "parish.example.com"]);
    expect(await auditCount(pid, "set_parish_custom_domains")).toBe(1);
  });

  it("setCustomDomains rejects a domain another parish already owns as conflict", async () => {
    const a = await freshParish("dom-a");
    await setCustomDomains(superId, a, ["shared-ug00.example.com"]);
    const b = await freshParish("dom-b");
    await expectAdminError(() => setCustomDomains(superId, b, ["shared-ug00.example.com"]), "conflict");
  });
});

describe("admin plane — module enablement", () => {
  it("setModuleEnabled rejects an always-on module (invalid) and toggles a toggleable one with audit", async () => {
    const pid = await freshParish("mod");
    await expectAdminError(() => setModuleEnabled(superId, pid, "dictionary", false), "invalid");
    await setModuleEnabled(superId, pid, "ocia", false);
    const { rows } = await su.query<{ enabled: boolean }>(
      "SELECT enabled FROM parish_modules WHERE parish_id = $1 AND module_key = 'ocia'",
      [pid],
    );
    expect(rows[0]!.enabled).toBe(false);
    expect(await auditCount(pid, "set_module_enabled")).toBe(1);
  });

  it("setDioceseModuleDefault writes the diocese-scoped row and audits (null parish target)", async () => {
    await setDioceseModuleDefault(superId, DIOCESE_AJ, "studio", false);
    const { rows } = await su.query<{ enabled: boolean }>(
      "SELECT enabled FROM diocese_modules WHERE diocese_id = $1 AND module_key = 'studio'",
      [DIOCESE_AJ],
    );
    expect(rows[0]!.enabled).toBe(false);
    const a = await su.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM admin_audit WHERE action = 'set_diocese_module_default' AND detail->>'diocese_id' = $1",
      [DIOCESE_AJ],
    );
    expect(a.rows[0]!.c).toBe(1);
  });
});

describe("admin plane — branding", () => {
  it("setParishBrand rejects a bad schema version (invalid) and persists a valid brand with audit", async () => {
    const pid = await freshParish("brand");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the runtime version guard
    await expectAdminError(() => setParishBrand(superId, pid, { v: 2 } as any), "invalid");
    await setParishBrand(superId, pid, { v: 1, displayName: "UG00 Brand", colors: { primary: "#102030" } });
    const { rows } = await su.query<{ brand: { displayName?: string } | null }>(
      "SELECT brand FROM parishes WHERE id = $1",
      [pid],
    );
    expect(rows[0]!.brand?.displayName).toBe("UG00 Brand");
    expect(await auditCount(pid, "set_parish_brand")).toBe(1);
  });
});

describe("admin plane — first-admin invite", () => {
  it("inviteFirstAdmin creates an admin membership in the parish and audits it", async () => {
    const pid = await freshParish("invite");
    const email = `${INVITE_EMAIL_PREFIX}-${(n += 1)}@parvaordo.test`;
    const result = await inviteFirstAdmin(superId, pid, email);
    expect(result.userId).toBeTruthy();
    const m = await su.query<{ role: string }>("SELECT role FROM memberships WHERE parish_id = $1 AND user_id = $2", [
      pid,
      result.userId,
    ]);
    expect(m.rows.map((r) => r.role)).toContain("admin");
    expect(await auditCount(pid, "invite_first_admin")).toBe(1);
  });

  it("inviteFirstAdmin maps a duplicate invite to conflict", async () => {
    const pid = await freshParish("invite2");
    const email = `${INVITE_EMAIL_PREFIX}-dup-${(n += 1)}@parvaordo.test`;
    await inviteFirstAdmin(superId, pid, email);
    await expectAdminError(() => inviteFirstAdmin(superId, pid, email), "conflict");
  });
});
