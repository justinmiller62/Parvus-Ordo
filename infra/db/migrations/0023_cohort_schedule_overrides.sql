-- 0023_cohort_schedule_overrides — restore per-entry time/location overrides on
-- cohort_schedule.
--
-- Narthex's cohort redesign moved `discussion_location` up to `cohorts` and added
-- per-schedule-row `time_override` / `location_override` so a single week can meet
-- at a different time/place than the cohort's weekly default. 0003 ported the
-- cohorts + cohort_schedule shell but omitted these two columns, so the calendar
-- read model in the schedule-calendar spec referenced a dropped column. The cohort
-- schedule read model resolves the EFFECTIVE meeting time/location as
--   COALESCE(entry.time_override,     cohort.discussion_time)
--   COALESCE(entry.location_override, cohort.discussion_location)
-- — this migration supplies the missing per-entry columns. (See docs/narthex/
-- cohorts.md + schedule-calendar.md, flagged legacy bug "dropped
-- cohort_schedule.discussion_location".)
--
-- cohort_schedule is a strictly parish-scoped activity table; its existing
-- `cohort_schedule_isolation` policy (0003, FOR ALL on parish_id) already covers
-- these new columns, so no RLS change is required.

ALTER TABLE cohort_schedule
  ADD COLUMN time_override     text,
  ADD COLUMN location_override text;
