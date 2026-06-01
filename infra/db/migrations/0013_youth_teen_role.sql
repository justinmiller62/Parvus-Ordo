-- 0013_youth_teen_role — add the youth_teen membership role for the Youth Teaches
-- module (teens who create short catechetical videos). Isolated in its own migration:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction it is added in.
ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'youth_teen';
