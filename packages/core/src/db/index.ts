// The DB client is the module's public surface. `int-guard` is deliberately not
// re-exported: it backs the integration globalSetup (../../../../vitest.int.setup.ts)
// and is imported directly there, never through the package barrel.
export * from "./client";
