// packages/core — the backend boundary (CLAUDE.md §5).
// ALL business logic, data access, and validators live here, organized by module
// so a module stays self-contained (and could later be extracted as a satellite).
// No React, no Next. Entry points (Server Actions, route handlers) are thin callers.

// shared infra
export * from "./db/client";
export * from "./branding";

// MCP transport (generic JSON-RPC framing shared by every MCP route)
export * from "./mcp";

// auth (app-issued API token + password login for the iOS surface)
export * from "./auth";

// platform (parish-OS core, cross-module)
export * from "./platform/parishes";
export * from "./platform/identity";
export * from "./platform/hostname";

// OCIA module
export * from "./ocia/lessons";
export * from "./ocia/answers";
export * from "./ocia/progress";
export * from "./ocia/feedback";
export * from "./ocia/discussion-template";
export * from "./ocia/weekly-export";

// media / asset manager
export * from "./media";

// onboarding (invite + public OCIA application)
export * from "./onboarding";

// people (parish member management console)
export * from "./people/members";

// dictionary (Catholic glossary — global entries + parish overrides/submissions)
export * from "./dictionary";

// prayers (Prayer Book — same three-layer model as dictionary)
export * from "./prayers";

// parvus studio (studio creators make short catechetical videos with AI help)
export * from "./youth-teaches";
