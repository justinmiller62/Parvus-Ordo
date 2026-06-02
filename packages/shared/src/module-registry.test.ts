import { describe, expect, it } from "vitest";
import { MODULES, moduleAvailable, resolveEnabled, type ModuleDef, type ModuleKey, type Role } from "./index";

const ALL_MODULE_KEYS: ModuleKey[] = ["ocia", "people", "studio", "dictionary", "prayers", "onboarding", "gather"];
// The modules enabled when a parish has no row. `gather` ships DARK (defaultEnabled:false,
// RFC-005 §2), so it is the one module absent here.
const DEFAULT_ON_KEYS: ModuleKey[] = ["ocia", "people", "studio", "dictionary", "prayers", "onboarding"];
const EVERY_ROLE = ["admin", "catechist", "catechumen_candidate", "parish_member", "studio", "super_admin"];

describe("MODULES registry", () => {
  it("contains exactly the seven module keys, each self-keyed", () => {
    expect([...Object.keys(MODULES)].sort()).toEqual([...ALL_MODULE_KEYS].sort());
    for (const key of ALL_MODULE_KEYS) expect(MODULES[key].key).toBe(key);
  });

  it("marks ocia, studio, and gather toggleable (po-wisp-rrwul + RFC-005 §2); all others always-on", () => {
    expect(ALL_MODULE_KEYS.filter((k) => MODULES[k].toggleable).sort()).toEqual(["gather", "ocia", "studio"]);
  });

  it("defaults every pre-existing module enabled (zero-change deploy, RFC-001 §3.6); gather ships dark (RFC-005 §2)", () => {
    for (const key of DEFAULT_ON_KEYS) expect(MODULES[key].defaultEnabled).toBe(true);
    expect(MODULES.gather.defaultEnabled).toBe(false);
  });

  it("gather is a parishioner-facing module usable by every parish role (RFC-005 §2)", () => {
    expect([...MODULES.gather.roles].sort()).toEqual(EVERY_ROLE);
  });

  it("ocia capability mirrors ociaEligible (staff + OCIA learners)", () => {
    expect([...MODULES.ocia.roles].sort()).toEqual(["admin", "catechist", "catechumen_candidate", "super_admin"]);
  });

  it("studio capability mirrors studioEligible (studio creators + catechists + admins)", () => {
    expect([...MODULES.studio.roles].sort()).toEqual(["admin", "catechist", "studio", "super_admin"]);
  });

  it("people capability mirrors peopleEligible (admins only)", () => {
    expect([...MODULES.people.roles].sort()).toEqual(["admin", "super_admin"]);
  });

  it("dictionary + prayers are usable by any parish role (their routes gate on parish, not role)", () => {
    expect([...MODULES.dictionary.roles].sort()).toEqual(EVERY_ROLE);
    expect([...MODULES.prayers.roles].sort()).toEqual(EVERY_ROLE);
  });
});

describe("resolveEnabled (3-layer overlay: defaults ← diocese ← parish)", () => {
  it("with no rows, enables every default-on module — and NOT gather (ships dark, RFC-005 §2)", () => {
    expect(resolveEnabled({})).toEqual(new Set(DEFAULT_ON_KEYS));
  });

  it("a parish row turns a toggleable module off (and leaves its sibling untouched)", () => {
    const enabled = resolveEnabled({ parish: [{ module_key: "ocia", enabled: false }] });
    expect(enabled.has("ocia")).toBe(false);
    expect(enabled.has("studio")).toBe(true);
  });

  it("gather ships dark and a row turns it on (RFC-005 §2 opt-in, both layers)", () => {
    expect(resolveEnabled({}).has("gather")).toBe(false);
    expect(resolveEnabled({ parish: [{ module_key: "gather", enabled: true }] }).has("gather")).toBe(true);
    // a diocese can opt a whole diocese in, cascading to parishes with no row
    expect(resolveEnabled({ diocese: [{ module_key: "gather", enabled: true }] }).has("gather")).toBe(true);
  });

  it("ignores rows for unknown module keys", () => {
    expect(resolveEnabled({ parish: [{ module_key: "not_a_module", enabled: true }] })).toEqual(
      new Set(DEFAULT_ON_KEYS),
    );
  });

  it("never disables an always-on (non-toggleable) module, even if a row says so (RFC-001 §3.1 cannot-be-disabled)", () => {
    const enabled = resolveEnabled({
      diocese: [{ module_key: "people", enabled: false }],
      parish: [{ module_key: "dictionary", enabled: false }],
    });
    expect(enabled.has("dictionary")).toBe(true); // pinned even against a parish row
    expect(enabled.has("people")).toBe(true); // pinned even against a diocese row
  });

  it("overlays a toggleable module in both directions (synthetic dark-launch: default-off, row turns on)", () => {
    const reg: Record<ModuleKey, ModuleDef> = { ...MODULES, ocia: { ...MODULES.ocia, defaultEnabled: false } };
    expect(resolveEnabled({}, reg).has("ocia")).toBe(false);
    expect(resolveEnabled({ parish: [{ module_key: "ocia", enabled: true }] }, reg).has("ocia")).toBe(true);
  });

  it("a diocese-level disable cascades to the parish when there is no parish row", () => {
    const enabled = resolveEnabled({ diocese: [{ module_key: "ocia", enabled: false }] });
    expect(enabled.has("ocia")).toBe(false); // inherited from the diocese
  });

  it("a parish row OVERRIDES its diocese row (most-specific wins, both directions)", () => {
    // diocese disables ocia, parish re-enables it → parish wins (on)
    const reEnabled = resolveEnabled({
      diocese: [{ module_key: "ocia", enabled: false }],
      parish: [{ module_key: "ocia", enabled: true }],
    });
    expect(reEnabled.has("ocia")).toBe(true);
    // diocese enables studio (redundant), parish disables it → parish wins (off)
    const reDisabled = resolveEnabled({
      diocese: [{ module_key: "studio", enabled: true }],
      parish: [{ module_key: "studio", enabled: false }],
    });
    expect(reDisabled.has("studio")).toBe(false);
  });
});

describe("moduleAvailable (enabled AND role-capable)", () => {
  const enabledAll = new Set<ModuleKey>(ALL_MODULE_KEYS);

  it("is false when the module is disabled, regardless of role", () => {
    const enabled = resolveEnabled({ parish: [{ module_key: "ocia", enabled: false }] });
    expect(moduleAvailable("admin", "ocia", enabled)).toBe(false);
  });

  it("is false for a null (signed-out) role", () => {
    expect(moduleAvailable(null, "ocia", enabledAll)).toBe(false);
  });

  it("requires the role to be capable of the module", () => {
    expect(moduleAvailable("parish_member", "ocia", enabledAll)).toBe(false);
    expect(moduleAvailable("admin", "ocia", enabledAll)).toBe(true);
  });

  it("gates studio to studio-capable roles only (not OCIA learners)", () => {
    expect(moduleAvailable("studio", "studio", enabledAll)).toBe(true);
    expect(moduleAvailable("catechumen_candidate", "studio", enabledAll)).toBe(false);
  });

  it("for an always-on module, availability is purely the role capability", () => {
    expect(moduleAvailable("admin", "people", enabledAll)).toBe(true);
    expect(moduleAvailable("catechist", "people", enabledAll)).toBe(false);
  });

  it("gather is available to any role once enabled, and to none while dark (RFC-005 §2)", () => {
    expect(moduleAvailable("parish_member", "gather", enabledAll)).toBe(true);
    expect(moduleAvailable("catechumen_candidate", "gather", enabledAll)).toBe(true);
    expect(moduleAvailable("parish_member", "gather", resolveEnabled({}))).toBe(false); // default-dark
  });
});
