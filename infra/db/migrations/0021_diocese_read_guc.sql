-- 0021_diocese_read_guc — drop the per-row correlated subquery from the three-tier
-- diocese READ policies; compare against a request-scoped GUC instead (bead po-djp).
--
-- Before: every diocese-scoped read evaluated
--   diocese_id = (SELECT p.diocese_id FROM parishes p WHERE p.id = current_setting('app.parish_id', true)::uuid)
-- in the USING clause. On the shared global+diocese content tables (read on hot OCIA
-- paths) this is the most expensive RLS predicate in the system.
--
-- After: getDb()/withTenant() resolve the active parish's diocese ONCE per request and
-- set it as `app.diocese_id` (see packages/core/src/db/client.ts), exactly the way
-- `app.parish_id` is set. The policy then compares two GUCs — no subquery, no per-row
-- (or even per-request) lookup inside the policy.
--
-- NULLIF(...,'') is required, not cosmetic: `set_config(..., true)` is transaction-local
-- and a custom GUC reverts to '' (empty string), NOT NULL, once it has been set on a
-- pooled connection. A bare ''::uuid throws "invalid input syntax for type uuid". A
-- parish with no diocese (parishes.diocese_id is nullable) leaves app.diocese_id unset/
-- empty, so NULLIF maps both '' and NULL to NULL → the diocese branch is simply false
-- (that parish sees no diocese content), never an error.
--
-- SCOPE: the bead names lessons_read / lesson_items_read (0003), but the identical
-- predicate was copied into lesson_versions_read (0006) and assets_read (0007). All four
-- are the same three-tier read; converting them together removes the subquery everywhere
-- it occurs and keeps the read path on one mechanism. Only the diocese branch changes —
-- the parish branch and all write (INSERT/UPDATE/DELETE) policies are untouched.
--
-- Indexes the GUC compare relies on already exist (lessons/assets scope_idx +
-- diocese_id_idx; versions/items read by version_id). No data change — USING swap only.

ALTER POLICY lessons_read ON lessons USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);

ALTER POLICY lesson_items_read ON lesson_items USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);

ALTER POLICY lesson_versions_read ON lesson_versions USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);

ALTER POLICY assets_read ON assets USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);
