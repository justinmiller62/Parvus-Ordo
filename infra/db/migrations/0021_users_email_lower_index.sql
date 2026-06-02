-- 0021_users_email_lower_index — make the login path an index lookup, and close a
-- case-variant login collision.
--
-- login_lookup (0009) filters `WHERE lower(u.email) = lower(p_email)` and runs on
-- every authenticated request (getViewer -> lookupAppUser). users.email is UNIQUE,
-- but the constraint's implicit btree (users_email_key) is case-SENSITIVE, so it
-- cannot serve a lower(email) predicate — the planner falls back to a sequential
-- scan over users, which degrades as the user table grows across all parishes.
--
-- Fix: a UNIQUE functional index on lower(email). It (a) lets login_lookup do an
-- index lookup instead of a seq scan, and (b) enforces case-insensitive uniqueness.
-- (b) also closes a latent correctness bug: with only the case-sensitive constraint,
-- 'A@x' and 'a@x' can coexist as two users, and login_lookup('a@x') would then match
-- BOTH rows — merging two distinct identities' memberships at login. A unique
-- lower(email) index makes that state unrepresentable.
--
-- Append-only per the migration model: we ADD the index and leave the existing
-- case-sensitive users_email_key in place (now subsumed by the stronger index, but
-- harmless; a later migration may drop it). Normalizing stored emails on write is a
-- separate, broader follow-up — comparison already lowercases both sides and now
-- uses this index, so it is not required to resolve this finding.
--
-- NOTE: no CONCURRENTLY. migrate.mjs wraps every migration file in a single
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. The brief lock is
-- acceptable at current scale; a much larger table would need an out-of-band
-- concurrent build instead.

-- Guard: a UNIQUE lower(email) index cannot be built while case-variant duplicate
-- emails already exist. Deciding which row wins (and whose memberships survive) is a
-- business decision, not something a migration should silently do — so detect the
-- collisions and abort with the offending addresses rather than corrupting auth data
-- or failing with an opaque unique-violation. The whole migration runs in one
-- transaction, so this RAISE rolls everything back cleanly and is safe to re-run
-- after the duplicates are resolved.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(lower_email || ' (x' || n || ')', ', ' ORDER BY lower_email)
    INTO collisions
  FROM (
    SELECT lower(email) AS lower_email, count(*) AS n
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) dups;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add unique index on users(lower(email)): case-variant duplicate email(s) exist: %. Merge or rename these users, then re-run this migration.', collisions;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
