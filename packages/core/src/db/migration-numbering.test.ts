// Repo-level guard: migration files must carry a UNIQUE NNNN_ numeric prefix, so two
// beads can never again ship the same number undetected. Regression guard for po-bdbo
// (reviewer-2 flagged a latent duplicate-0021 collision during the po-qdw6 review; same
// family as the po-mf1/po-k92 0022 catch). A duplicate NNNN_ prefix is invisible to git
// rebase and to tsc — only an explicit check catches it.
//
// WHY THE EXISTING 0021 PAIR IS GRANDFATHERED (not renumbered):
//   infra/db/migrate.mjs tracks applied migrations in `_migrations(name text PRIMARY KEY)`,
//   keyed on the FULL FILENAME — it applies a file unless `applied.has(file)` and records
//   `INSERT INTO _migrations(name) VALUES (file)`. The two 0021 files have DISTINCT full
//   names, so BOTH already applied (ordered by filename sort: diocese_read_guc, then
//   lesson_versions_*) on every environment. Renumbering either would change its tracked
//   `name`, so the runner would RE-APPLY it on already-migrated DBs — and
//   0021_lesson_versions_drop_redundant_lesson_id_idx.sql is `DROP INDEX ...` which ERRORS
//   the second time (the index is already gone). So the safe resolution is: leave both
//   files as-is and prevent RECURRENCE with this guard, grandfathering only this one
//   historical pair. See the bead for the full analysis.
//
// Lives under packages/core/src so Vitest collects it (vitest.config.ts includes
// packages/**/src/**/*.test.ts) and it rides the existing CI unit gate (`pnpm test`).
// Pure filesystem read — no DB, no core logic.
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const MIGRATIONS_REL = "infra/db/migrations";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Every `.sql` migration file, in the same order the runner sees them (filename sort). */
function migrationFiles(): string[] {
  return readdirSync(join(ROOT, MIGRATIONS_REL))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Map each NNNN_ prefix → the files carrying it, keeping only prefixes with >1 file. */
function duplicatePrefixes(files: string[]): Record<string, string[]> {
  const byPrefix: Record<string, string[]> = {};
  for (const f of files) {
    const prefix = /^(\d{4})_/.exec(f)?.[1];
    if (!prefix) continue; // naming-convention violations are caught by their own test below
    (byPrefix[prefix] ??= []).push(f);
  }
  return Object.fromEntries(Object.entries(byPrefix).filter(([, fs]) => fs.length > 1));
}

// The ONLY duplicate prefix allowed to exist, and the EXACT files it may cover. Both are
// already applied on every environment; renumbering would re-run an applied migration
// (the DROP INDEX would error). Do NOT add to this list — a new duplicate is a bug.
const GRANDFATHERED_DUPLICATE_PREFIX = "0021";
const GRANDFATHERED_0021_FILES = ["0021_diocese_read_guc.sql", "0021_lesson_versions_drop_redundant_lesson_id_idx.sql"];

describe("migration numbering guard (po-bdbo)", () => {
  it("every migration file is named NNNN_<slug>.sql (4-digit numeric prefix)", () => {
    const bad = migrationFiles().filter((f) => !/^\d{4}_.+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  it("the runner keys on FULL FILENAME — which is what makes grandfathering the 0021 pair safe", () => {
    // If this ever changes (e.g. the runner starts keying on the NUMBER), the safety
    // argument for the grandfathered pair collapses and the 0021 situation must be
    // re-evaluated — so pin the runner's tracking semantics here.
    const runner = read("infra/db/migrate.mjs");
    expect(runner).toMatch(/_migrations\s*\(name text PRIMARY KEY/);
    expect(runner).toContain("applied.has(file)");
    expect(runner).toContain("INSERT INTO _migrations(name) VALUES ($1)");
  });

  it("detects duplicate prefixes (the guard logic actually flags a collision)", () => {
    // Synthetic proof the detector works — otherwise the real-files test could pass vacuously.
    expect(duplicatePrefixes(["0001_a.sql", "0001_b.sql", "0002_c.sql", "0003_d.sql"])).toEqual({
      "0001": ["0001_a.sql", "0001_b.sql"],
    });
    expect(duplicatePrefixes(["0001_a.sql", "0002_b.sql"])).toEqual({});
  });

  it("no migration number is duplicated, except the documented historical 0021 pair", () => {
    const dupes = duplicatePrefixes(migrationFiles());
    const unexpected = Object.fromEntries(
      Object.entries(dupes).filter(([prefix]) => prefix !== GRANDFATHERED_DUPLICATE_PREFIX),
    );
    // A failure here means a NEW duplicate NNNN_ prefix landed — pick the next free number
    // (above the current max), do NOT reuse an existing one. See this file's header.
    expect(unexpected).toEqual({});
  });

  it("the grandfathered 0021 pair is still exactly the two known historical files", () => {
    const dupes = duplicatePrefixes(migrationFiles());
    // Pin the exception so it can never silently grow (a third 0021_) or drift.
    expect((dupes[GRANDFATHERED_DUPLICATE_PREFIX] ?? []).sort()).toEqual(GRANDFATHERED_0021_FILES);
  });
});
