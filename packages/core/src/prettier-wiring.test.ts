// Repo-level guard: the Prettier formatter must stay wired — an explicit config,
// the format / format:check scripts, an ignore file, and a CI gate that runs it.
// Regression guard for po-4gy (formatting was previously unconfigured + unenforced).
// It lives under packages/core/src only so Vitest collects it (vitest.config.ts
// includes packages/**/src/**/*.test.ts); it exercises no core logic.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above the test file");
}

const ROOT = repoRoot();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("prettier formatting is wired (po-4gy)", () => {
  it("pins an explicit printWidth of 120 (the repo's house width, not Prettier's 80 default)", () => {
    const cfg = JSON.parse(read(".prettierrc.json"));
    expect(cfg.printWidth).toBe(120);
  });

  it("exposes format and format:check scripts at the repo root", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.format).toContain("prettier --write");
    expect(pkg.scripts["format:check"]).toContain("prettier --check");
  });

  it("keeps the formatter off the lockfile and off markdown prose", () => {
    const ignore = read(".prettierignore");
    expect(ignore).toContain("pnpm-lock.yaml");
    expect(ignore).toMatch(/\*\.md/);
  });

  it("runs the format check as a CI gate on development", () => {
    const ci = read(".github/workflows/development.yml");
    expect(ci).toContain("format:check");
  });
});
