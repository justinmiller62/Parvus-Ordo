-- 0028_diocese_modules — per-DIOCESE module enablement (RFC-001 §3.3 diocese-cascade
-- layer). The layered overlay was designed in RFC-001 but the diocese layer was deferred
-- to v2; it is activated now by build authorization po-wisp-rrwul / RFC-004 D1.
--
-- SPARSE rows like parish_modules (0027): a missing (diocese, module) row means "fall
-- through to the registry default". The pure 3-layer resolver overlays
--   defaults  <-  diocese_modules  <-  parish_modules    (most-specific wins)
-- in packages/shared resolveEnabled; a parish row overrides its diocese row, which
-- overrides the registry default. Non-toggleable modules can never be disabled by any
-- layer (the resolver pins them on).
--
-- RLS scopes by the request's diocese GUC (app.diocese_id), which getDb sets from the
-- ACTIVE parish's diocese — so a parish member reads exactly their own diocese's rows and
-- can never read or write another diocese's. NULLIF(...,'') matches the diocese content
-- cascade (0021): set_config(..., true) is a custom GUC that reverts to '' (not NULL) on a
-- pooled connection, and a parish with no diocese leaves it unset, so both '' and NULL map
-- to NULL → diocese_id = NULL is never true → a no-diocese parish simply sees no rows.
--
-- WRITE AUTHORITY (super-admin only) is enforced at the systems-admin management layer
-- (RFC-004), which is out of scope here; this policy provides the diocese-SCOPING (no
-- cross-diocese read or write), mirroring parish_modules_isolation adapted to diocese_id.

CREATE TABLE diocese_modules (
  diocese_id  uuid NOT NULL REFERENCES dioceses(id) ON DELETE CASCADE,
  module_key  text NOT NULL,
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diocese_id, module_key)
);
ALTER TABLE diocese_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY diocese_modules_isolation ON diocese_modules FOR ALL
  USING (diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  WITH CHECK (diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid);
