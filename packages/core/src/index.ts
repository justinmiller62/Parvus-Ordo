// packages/core — the backend boundary (CLAUDE.md §5).
// ALL business logic, data access, and validators live here, organized by module
// so a module stays self-contained (and could later be extracted as a satellite).
// No React, no Next. Entry points (Server Actions, route handlers) are thin callers.

// shared infra
export * from "./db";
export * from "./branding";
export * from "./content"; // three-layer content engine shared by dictionary + prayers

// MCP transport (generic JSON-RPC framing shared by every MCP route)
export * from "./mcp";

// auth (app-issued API token + password login for the iOS surface)
export * from "./auth";

// platform (parish-OS core, cross-module)
export * from "./platform";

// OCIA module
export * from "./ocia";

// cohorts — student grouping, scheduling, gating, learning paths (keystone)
export * from "./cohorts";

// calendar — unified events + iCal feeds + cohort-schedule overlay (consumes cohorts)
export * from "./calendar";

// media / asset manager
export * from "./media";

// onboarding (invite + public OCIA application)
export * from "./onboarding";

// people (parish member management console)
export * from "./people";

// dictionary (Catholic glossary — global entries + parish overrides/submissions)
export * from "./dictionary";

// prayers (Prayer Book — same three-layer model as dictionary)
export * from "./prayers";

// parvus studio (studio creators make short catechetical videos with AI help)
export * from "./youth-teaches";

// parvus gather (RFC-005) — parish groups, RBAC, and the Requests coordination spine
export * from "./gather";
