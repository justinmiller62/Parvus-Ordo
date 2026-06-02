// Repo-level guard: packages/core exposes every module through one uniform barrel
// convention — the root index.ts re-exports each module's own index.ts
// (`export * from "./ocia"`) and never reaches into a module's individual files
// (`export * from "./ocia/lessons"`). Keeps module boundaries consistent so the
// toggleable-per-parish refactor stays tractable. Regression guard for po-a56.
// Lives under packages/core/src so Vitest collects it (vitest.config.ts includes
// packages/**/src/**/*.test.ts); it exercises no core logic.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const rootBarrel = readFileSync(join(SRC, "index.ts"), "utf8");

// Every relative re-export target named in the root barrel, e.g. "./ocia" or "./db/client".
const reexportPaths = [...rootBarrel.matchAll(/from\s+"(\.\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((p): p is string => p !== undefined);

describe("packages/core barrel structure is uniform (po-a56)", () => {
  it("re-exports whole modules, never individual module files", () => {
    // A module path is a single segment ("./ocia"); a deeper path digs into a
    // module's files ("./ocia/lessons"). The root barrel must only name modules.
    const deep = reexportPaths.filter((p) => p.split("/").length > 2);
    expect(deep).toEqual([]);
  });

  it("backs every re-exported module with its own index.ts barrel", () => {
    const missing = reexportPaths.filter((p) => !existsSync(join(SRC, p, "index.ts")));
    expect(missing).toEqual([]);
  });
});
