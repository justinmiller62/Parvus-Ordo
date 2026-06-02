import { describe, expect, it } from "vitest";
import { orNull, trimOrEmpty } from "./index";

describe("orNull", () => {
  it("trims and returns the value when non-empty", () => {
    expect(orNull("  hi  ")).toBe("hi");
    expect(orNull("hi")).toBe("hi");
  });

  it("returns null for nullish, empty, or whitespace-only input", () => {
    expect(orNull(undefined)).toBeNull();
    expect(orNull(null)).toBeNull();
    expect(orNull("")).toBeNull();
    expect(orNull("   ")).toBeNull();
  });
});

describe("trimOrEmpty", () => {
  it("trims a present string", () => {
    expect(trimOrEmpty("  hi  ")).toBe("hi");
    expect(trimOrEmpty("hi")).toBe("hi");
  });

  it("returns an empty string for nullish or whitespace-only input", () => {
    expect(trimOrEmpty(undefined)).toBe("");
    expect(trimOrEmpty(null)).toBe("");
    expect(trimOrEmpty("")).toBe("");
    expect(trimOrEmpty("   ")).toBe("");
  });
});
