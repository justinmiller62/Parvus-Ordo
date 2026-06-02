// Parvus Gather (RFC-005) — community-life module: groups, group RBAC, requests, …
// One module barrel; each sub-namespace (rbac/, groups/, requests/, …) has its own index.
// NOTE: T1-c (groups) and T1-e (requests) add their own `export *` lines here in parallel —
// union them at merge.
export * from "./rbac";
