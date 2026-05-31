import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The e2e suite operates entirely within a dedicated "E2E Test Parish". This
// (re)creates ONLY that parish + its fixtures (by fixed UUID / `e2e-` email
// prefix) — it never TRUNCATEs and never touches the demo data (Holy Spirit /
// St. Monica, locally-uploaded media, manual edits). Running it before each
// suite guarantees pristine fixtures even if a prior run left debris.
//
// Per-spec state (a learner's answers/progress) is still reset via /dev/reset;
// anything a spec creates through the UI it deletes through the UI.
export default function globalSetup(): void {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/web/e2e
  const repoRoot = resolve(here, "../../.."); // → repo root (has .env)
  execFileSync("node", ["infra/db/seed-e2e.mjs"], { cwd: repoRoot, stdio: "inherit" });
}
