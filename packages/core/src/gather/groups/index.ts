// Parvus Gather — the ONE Group primitive (RFC-005 §3.1/§3.3, po-05xo): group CRUD + archive,
// roster (add/remove/assign/handoff with the append-only role-transition log), role definition,
// and the visibility read-filter. Pure core scoped by getDb(parishId)/RLS; authz is the T1-g shim.
export * from "./types";
export * from "./groups";
export * from "./roles";
export * from "./roster";
