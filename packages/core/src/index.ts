// packages/core — the backend boundary (CLAUDE.md §5).
// ALL business logic, data access, and validators live here, organized by module
// so a module stays self-contained (and could later be extracted as a satellite).
// No React, no Next. Entry points (Server Actions, route handlers) are thin callers.

// shared infra
export * from "./db/client";
export * from "./branding";

// platform (parish-OS core, cross-module)
export * from "./platform/parishes";
export * from "./platform/identity";

// OCIA module
export * from "./ocia/lessons";
export * from "./ocia/answers";
export * from "./ocia/progress";
