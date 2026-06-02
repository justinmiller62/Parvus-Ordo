import { describe, expect, it } from "vitest";
import { AdminError, isValidCustomDomain } from "./admin";

// Pure-logic unit coverage for admin.ts. The DB-touching surface (super-admin gate, DEFINER
// routing, audit-per-write) is exercised in admin.int.test.ts against the RLS database.

describe("isValidCustomDomain — the custom-domain resolve-key shape guard", () => {
  it("accepts bare registrable hostnames", () => {
    expect(isValidCustomDomain("parish.example.com")).toBe(true);
    expect(isValidCustomDomain("holy-spirit.org")).toBe(true);
    expect(isValidCustomDomain("a.co")).toBe(true);
    expect(isValidCustomDomain("sub.deep.example.co.uk")).toBe(true);
    expect(isValidCustomDomain("xn--80ak6aa92e.com")).toBe(true); // punycode label
  });

  it("normalizes case + surrounding whitespace before checking", () => {
    expect(isValidCustomDomain("  Parish.Example.COM  ")).toBe(true);
  });

  it("rejects non-hostnames: empty, single label, URL, port, path, whitespace", () => {
    expect(isValidCustomDomain("")).toBe(false);
    expect(isValidCustomDomain("localhost")).toBe(false); // no dot — not registrable
    expect(isValidCustomDomain("https://parish.example.com")).toBe(false); // scheme
    expect(isValidCustomDomain("parish.example.com:443")).toBe(false); // port
    expect(isValidCustomDomain("parish.example.com/admin")).toBe(false); // path
    expect(isValidCustomDomain("parish .example.com")).toBe(false); // inner space
  });

  it("rejects malformed labels: leading/trailing/double hyphen, empty label, underscore", () => {
    expect(isValidCustomDomain("-parish.example.com")).toBe(false);
    expect(isValidCustomDomain("parish-.example.com")).toBe(false);
    expect(isValidCustomDomain("parish..example.com")).toBe(false);
    expect(isValidCustomDomain("par_ish.example.com")).toBe(false);
    expect(isValidCustomDomain(".example.com")).toBe(false);
    expect(isValidCustomDomain("example.com.")).toBe(false);
  });

  it("rejects an over-long label (>63 chars)", () => {
    expect(isValidCustomDomain(`${"a".repeat(64)}.com`)).toBe(false);
    expect(isValidCustomDomain(`${"a".repeat(63)}.com`)).toBe(true);
  });
});

describe("AdminError", () => {
  it("carries a typed code the route maps to HTTP semantics", () => {
    const err = new AdminError("forbidden", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AdminError");
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe("nope");
  });
});
