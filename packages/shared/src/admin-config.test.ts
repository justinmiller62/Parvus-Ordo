import { describe, expect, it } from "vitest";
import { canTransitionParishStatus, isValidSlug, PARISH_STATUSES, resolveBrand, type BrandConfig } from "./index";

describe("isValidSlug (RFC-004 §6.1)", () => {
  it("accepts lowercase, hyphen-joined alphanumeric slugs", () => {
    for (const s of ["holyspirit-austin", "stmonica", "abc", "a1b2", "holy-spirit-lock-haven", "x".repeat(63)]) {
      expect(isValidSlug(s)).toBe(true);
    }
  });

  it("rejects bad case, charset, and hyphen placement", () => {
    for (const s of ["Holy", "holy_spirit", "holy spirit", "holy.spirit", "-holy", "holy-", "holy--spirit", "holyÉ"]) {
      expect(isValidSlug(s)).toBe(false);
    }
  });

  it("rejects out-of-bounds lengths", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("ab")).toBe(false); // below the minimum
    expect(isValidSlug("x".repeat(64))).toBe(false); // above the DNS-label maximum
  });

  it("rejects reserved labels (kept aligned with the hostname resolver)", () => {
    expect(isValidSlug("www")).toBe(false);
    expect(isValidSlug("app")).toBe(false);
  });
});

describe("parish lifecycle status (RFC-004 §8)", () => {
  it("defines exactly the three states", () => {
    expect([...PARISH_STATUSES]).toEqual(["pending_setup", "active", "suspended"]);
  });

  it("allows the lifecycle transitions and the idempotent no-op", () => {
    expect(canTransitionParishStatus("pending_setup", "active")).toBe(true);
    expect(canTransitionParishStatus("pending_setup", "suspended")).toBe(true);
    expect(canTransitionParishStatus("active", "suspended")).toBe(true);
    expect(canTransitionParishStatus("suspended", "active")).toBe(true);
    expect(canTransitionParishStatus("active", "active")).toBe(true);
  });

  it("rejects un-completing setup and other illegal moves", () => {
    expect(canTransitionParishStatus("active", "pending_setup")).toBe(false);
    expect(canTransitionParishStatus("suspended", "pending_setup")).toBe(false);
  });
});

describe("resolveBrand cascade (RFC-004 §7)", () => {
  const system: BrandConfig = {
    v: 1,
    displayName: "Parvus Ordo",
    logoUrl: "/system-logo.svg",
    colors: { primary: "#102a43", accent: "#d4a017", onPrimary: "#ffffff" },
    emailFromName: "Parvus Ordo",
  };

  it("returns the system defaults when no diocese/parish brand is set", () => {
    expect(resolveBrand(system)).toEqual(system);
  });

  it("resolves most-specific-wins per field (parish > diocese > system)", () => {
    const diocese: BrandConfig = { v: 1, displayName: "Diocese of Altoona", colors: { accent: "#7b1113" } };
    const parish: BrandConfig = { v: 1, displayName: "Holy Spirit", loginTagline: "Welcome home" };
    const r = resolveBrand(system, diocese, parish);
    expect(r.displayName).toBe("Holy Spirit"); // parish
    expect(r.loginTagline).toBe("Welcome home"); // parish-only
    expect(r.logoUrl).toBe("/system-logo.svg"); // inherited from system
    expect(r.emailFromName).toBe("Parvus Ordo"); // inherited from system
    expect(r.colors).toEqual({ primary: "#102a43", accent: "#7b1113", onPrimary: "#ffffff" });
  });

  it("merges colors per sub-field across all three tiers", () => {
    const diocese: BrandConfig = { v: 1, colors: { accent: "#7b1113" } };
    const parish: BrandConfig = { v: 1, colors: { primary: "#222222" } };
    expect(resolveBrand(system, diocese, parish).colors).toEqual({
      primary: "#222222", // parish
      accent: "#7b1113", // diocese
      onPrimary: "#ffffff", // system
    });
  });

  it("skips an absent diocese tier (parish still overlays system)", () => {
    const parish: BrandConfig = { v: 1, displayName: "Holy Spirit" };
    expect(resolveBrand(system, undefined, parish).displayName).toBe("Holy Spirit");
  });

  it("omits fields that no tier defines", () => {
    const r = resolveBrand({ v: 1, displayName: "Only Name" });
    expect(r).toEqual({ v: 1, displayName: "Only Name" });
    expect("colors" in r).toBe(false);
    expect("logoUrl" in r).toBe(false);
  });

  it("lets an explicit empty string override a more-general value (only undefined defers)", () => {
    const parish: BrandConfig = { v: 1, loginTagline: "" };
    expect(resolveBrand({ v: 1, loginTagline: "Default" }, undefined, parish).loginTagline).toBe("");
  });
});
