import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND, resolveBrand } from "./index";

describe("resolveBrand", () => {
  it("returns the default Parvus Ordo brand (stub cascade)", () => {
    expect(resolveBrand("ocia.holyspiritparish.org")).toBe(DEFAULT_BRAND);
  });

  it("tolerates a null hostname", () => {
    expect(resolveBrand(null)).toBe(DEFAULT_BRAND);
  });
});

describe("DEFAULT_BRAND", () => {
  it("carries the Parvus Ordo identity", () => {
    expect(DEFAULT_BRAND.name).toBe("Parvus Ordo");
    expect(DEFAULT_BRAND.tagline).toMatch(/rightly ordered/i);
  });

  it("defines the full six-color palette as hex", () => {
    const colors = Object.values(DEFAULT_BRAND.colors);
    expect(colors).toHaveLength(6);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
