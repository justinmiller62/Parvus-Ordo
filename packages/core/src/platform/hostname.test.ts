import { describe, expect, it } from "vitest";
import { resolveParishRef } from "./hostname";

describe("resolveParishRef", () => {
  describe("base = parvusordo.com (prod)", () => {
    const base = "parvusordo.com";
    it("the bare base domain is the apex", () => {
      expect(resolveParishRef("parvusordo.com", base)).toEqual({ kind: "apex" });
    });
    it("www/app map to the apex, not a parish", () => {
      expect(resolveParishRef("www.parvusordo.com", base)).toEqual({ kind: "apex" });
      expect(resolveParishRef("app.parvusordo.com", base)).toEqual({ kind: "apex" });
    });
    it("a single leftmost label is the parish slug", () => {
      expect(resolveParishRef("holy-spirit.parvusordo.com", base)).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
    it("a host not under the base domain is a custom domain", () => {
      expect(resolveParishRef("holyspiritlockhaven.org", base)).toEqual({ kind: "custom", domain: "holyspiritlockhaven.org" });
    });
    it("deeper sub-subdomains are not parish slugs (→ apex)", () => {
      expect(resolveParishRef("a.b.parvusordo.com", base)).toEqual({ kind: "apex" });
    });
  });

  describe("environment portability — same slug, every base domain", () => {
    it("resolves holy-spirit by slug in local/dev/stage/prod", () => {
      expect(resolveParishRef("holy-spirit.localhost", "localhost")).toEqual({ kind: "slug", slug: "holy-spirit" });
      expect(resolveParishRef("holy-spirit.dev.parvusordo.com", "dev.parvusordo.com")).toEqual({ kind: "slug", slug: "holy-spirit" });
      expect(resolveParishRef("holy-spirit.stage.parvusordo.com", "stage.parvusordo.com")).toEqual({ kind: "slug", slug: "holy-spirit" });
      expect(resolveParishRef("holy-spirit.parvusordo.com", "parvusordo.com")).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
  });

  describe("normalization", () => {
    it("strips the port", () => {
      expect(resolveParishRef("holy-spirit.localhost:3000", "localhost")).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
    it("is case-insensitive", () => {
      expect(resolveParishRef("Holy-Spirit.LOCALHOST", "localhost")).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
    it("null/empty host is the apex", () => {
      expect(resolveParishRef(null, "localhost")).toEqual({ kind: "apex" });
      expect(resolveParishRef("", "localhost")).toEqual({ kind: "apex" });
    });
    it("bare localhost is the apex", () => {
      expect(resolveParishRef("localhost:3000", "localhost")).toEqual({ kind: "apex" });
    });
  });
});
