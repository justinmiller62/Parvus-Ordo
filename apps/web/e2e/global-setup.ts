import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reset the DB to a clean seed before the E2E suite so builder/fork tests (which
// create lessons) don't accumulate across runs.
export default function globalSetup(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  execSync("node infra/db/seed.mjs", { cwd: repoRoot, stdio: "inherit" });
}
