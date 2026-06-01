-- 0016_rename_role_youth_teen_to_studio — the module formerly 'Youth Teaches' is
-- now 'Parvus Studio'; the membership role follows. RENAME VALUE is in-place (PG10+),
-- so existing memberships keep working with the new label automatically.
ALTER TYPE membership_role RENAME VALUE 'youth_teen' TO 'studio';
