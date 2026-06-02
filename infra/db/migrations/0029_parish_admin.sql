-- 0029_parish_admin — parish lifecycle status + admin-plane audit log (RFC-004 §4.1).
--
-- `status` defaults to 'active', so adding it is a ZERO-behavior-change deploy (every
-- existing parish stays active; new shells are created 'pending_setup' by the admin plane).
--
-- admin_audit is the tamper-evident record of privileged admin-plane actions. It is locked
-- to the tenant/app plane on BOTH layers: (1) RLS enabled with NO policy → default-deny for
-- every non-owner role, and (2) the grant inherited from 0001's ALTER DEFAULT PRIVILEGES is
-- REVOKED. Rows are written only by the SECURITY DEFINER admin functions (0030, which run
-- as the table owner and bypass both layers); reads are reserved for a future admin DEFINER
-- reader. `detail` jsonb is for context only and NEVER stores secrets.

ALTER TABLE parishes
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_setup', 'active', 'suspended'));

CREATE TABLE admin_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id    uuid NOT NULL REFERENCES users(id),
  action           text NOT NULL,
  target_parish_id uuid REFERENCES parishes(id) ON DELETE SET NULL,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb, -- context only; NEVER secrets
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_target_idx ON admin_audit(target_parish_id);
CREATE INDEX admin_audit_actor_idx ON admin_audit(actor_user_id);

ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;
-- 0001 ALTER DEFAULT PRIVILEGES auto-grants CRUD on new public tables to parvaordo_app; strip
-- it here so the audit log is locked at the GRANT layer too, not RLS alone (defense in depth).
-- The DEFINER writers own the table and are unaffected.
REVOKE ALL ON TABLE admin_audit FROM parvaordo_app;
