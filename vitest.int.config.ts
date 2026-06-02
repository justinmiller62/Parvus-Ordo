import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration layer (Architecture §14, Layer 2): real Postgres + RLS.
// Locally this hits the Docker DB; CI runs it against a Postgres service.
// (Neon DB branching per-test is the production CI form of this layer.)
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.int.test.ts"],
    environment: "node",
    fileParallelism: false,
    // Fail fast (and loudly) when the integration DB is unconfigured, unreachable,
    // or unseeded — rather than a wall of per-test connection errors, or a green
    // run against an empty DB (po-99f).
    globalSetup: ["./vitest.int.setup.ts"],
  },
  resolve: {
    alias: {
      "@parvaordo/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@parvaordo/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
});
