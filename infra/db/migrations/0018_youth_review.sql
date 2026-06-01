-- 0018_youth_review — a submitted Parvus Studio recording can be approved or
-- rejected by a catechist/admin. Extend the project status check accordingly.
ALTER TABLE youth_projects DROP CONSTRAINT youth_projects_status_check;
ALTER TABLE youth_projects ADD CONSTRAINT youth_projects_status_check
  CHECK (status IN ('drafting', 'ready_to_record', 'submitted', 'approved', 'rejected'));
