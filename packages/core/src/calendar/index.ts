// calendar — the unified Calendar: parish/diocese events (calendar_events), external iCal
// feed sources (calendar_sources, live-fetched via a SSRF-guarded pure fetcher), and the
// cohort-schedule overlay. All three streams normalize to a single MergedEvent the grid
// renders; the React layer never computes ghosts, recurrence, or time parsing. (po-oa5n)
export * from "./types";
export * from "./time";
export * from "./ical";
export * from "./events";
export * from "./sources";
export * from "./overlay";
