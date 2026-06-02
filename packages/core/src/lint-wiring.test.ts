// Repo-level guard: ESLint must stay wired — a flat config, the root lint script
// running ESLint directly (Next 16 removed `next lint`), the eslint dependency,
// and a CI gate that runs it. Regression guard for po-13n (linting was
// previously unconfigured + unenforced: `next lint` errored on invocation and
// CI never ran lint, so disable directives were dead no-ops). It lives under
// packages/core/src only so Vitest collects it (vitest.config.ts includes
// packages/**/src/**/*.test.ts); it exercises no core logic.
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

describe("eslint linting is wired (po-13n)", () => {
  it("ships a flat ESLint config at the repo root", () => {
    expect(existsSync(join(ROOT, "eslint.config.mjs"))).toBe(true);
  });

  it("runs ESLint directly from the root lint script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.lint).toContain("eslint");
  });

  it("no longer invokes the removed `next lint` (root or web app)", () => {
    const rootPkg = JSON.parse(read("package.json"));
    const webPkg = JSON.parse(read("apps/web/package.json"));
    expect(rootPkg.scripts.lint).not.toContain("next lint");
    // The web app defines no separate lint script now — root `eslint .` lints
    // the whole workspace in one pass — but guard against `next lint` returning.
    expect(webPkg.scripts.lint ?? "").not.toContain("next lint");
  });

  it("declares eslint as a dependency so the gate can actually run", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies).toHaveProperty("eslint");
  });

  it("runs lint as a CI gate on development", () => {
    const ci = read(".github/workflows/development.yml");
    expect(ci).toContain("pnpm lint");
  });
});
