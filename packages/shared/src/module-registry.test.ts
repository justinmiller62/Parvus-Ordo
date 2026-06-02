import { describe, expect, it } from "vitest";
import { MODULES, moduleAvailable, resolveEnabled, type ModuleDef, type ModuleKey, type Role } from "./index";

const ALL_MODULE_KEYS: ModuleKey[] = ["ocia", "people", "studio", "dictionary", "prayers", "onboarding"];
const EVERY_ROLE = ["admin", "catechist", "catechumen_candidate", "parish_member", "studio", "super_admin"];

describe("MODULES registry", () => {
  it("contains exactly the six module keys, each self-keyed", () => {
    expect([...Object.keys(MODULES)].sort()).toEqual([...ALL_MODULE_KEYS].sort());
    for (const key of ALL_MODULE_KEYS) expect(MODULES[key].key).toBe(key);
  });

  it("marks ONLY ocia and studio toggleable (locked override po-wisp-rrwul); all others always-on", () => {
    expect(ALL_MODULE_KEYS.filter((k) => MODULES[k].toggleable).sort()).toEqual(["ocia", "studio"]);
  });

  it("defaults every module enabled — introducing the toggle is a zero-behavior-change deploy (RFC-001 §3.6)", () => {
    for (const key of ALL_MODULE_KEYS) expect(MODULES[key].defaultEnabled).toBe(true);
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

describe("resolveEnabled (pure overlay: registry defaults ← parish rows)", () => {
  it("with no rows, enables every module whose defaultEnabled is true", () => {
    expect(resolveEnabled([])).toEqual(new Set(ALL_MODULE_KEYS));
  });

  it("a parish row turns a toggleable module off (and leaves its sibling untouched)", () => {
    const enabled = resolveEnabled([{ module_key: "ocia", enabled: false }]);
    expect(enabled.has("ocia")).toBe(false);
    expect(enabled.has("studio")).toBe(true);
  });

  it("ignores rows for unknown module keys", () => {
    expect(resolveEnabled([{ module_key: "not_a_module", enabled: true }])).toEqual(new Set(ALL_MODULE_KEYS));
  });

  it("never disables an always-on (non-toggleable) module, even if a row says so (RFC-001 §3.1 cannot-be-disabled)", () => {
    const enabled = resolveEnabled([
      { module_key: "dictionary", enabled: false },
      { module_key: "people", enabled: false },
    ]);
    expect(enabled.has("dictionary")).toBe(true);
    expect(enabled.has("people")).toBe(true);
  });

  it("overlays a toggleable module in both directions (synthetic dark-launch: default-off, row turns on)", () => {
    const reg: Record<ModuleKey, ModuleDef> = { ...MODULES, ocia: { ...MODULES.ocia, defaultEnabled: false } };
    expect(resolveEnabled([], reg).has("ocia")).toBe(false);
    expect(resolveEnabled([{ module_key: "ocia", enabled: true }], reg).has("ocia")).toBe(true);
  });
});

describe("moduleAvailable (enabled AND role-capable)", () => {
  const enabledAll = new Set<ModuleKey>(ALL_MODULE_KEYS);

  it("is false when the module is disabled, regardless of role", () => {
    const enabled = resolveEnabled([{ module_key: "ocia", enabled: false }]);
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
});
