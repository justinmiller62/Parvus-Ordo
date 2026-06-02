import ICAL from "ical.js";
import { RRule, rrulestr } from "rrule";
import { addDays, compareDates, type ISODate } from "../cohorts/dates";
import { addMinutes, localDateTime, type TimeOfDay } from "./time";
import type { MergedEvent } from "./types";

// The iCal pipeline as PURE core: a hardened server-side fetch (the proxy-ical
// replacement) + a parser that expands RRULE/EXDATE within the visible window. No React,
// no Next — `ical.js` + `rrule` live here (port notes). The leaked service_role JWT from
// the Narthex Edge Function is NOT reproduced: auth is the WorkOS session at the route.

// ─── fetchFeed — host whitelist + SSRF guard + HTTPS-only + size/time limits ─────

/** Allowed feed host suffixes (Narthex whitelist). Extendable via ICAL_ALLOWED_HOSTS. */
const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  "calendar.google.com",
  "googleapis.com",
  "ical-feeds.com",
  "faithlife.com",
  "churchofjesuschrist.org",
  "dioceseaj.org",
] as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECTS = 5;

export type IcalFetchErrorCode =
  | "bad_url"
  | "not_https"
  | "host_not_allowed"
  | "private_ip"
  | "too_large"
  | "timeout"
  | "fetch_failed";

/** A typed failure from fetchFeed; `httpStatus` is the status a route handler should surface. */
export class IcalFetchError extends Error {
  constructor(
    readonly code: IcalFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IcalFetchError";
  }

  get httpStatus(): number {
    switch (this.code) {
      case "bad_url":
      case "not_https":
        return 400;
      case "host_not_allowed":
      case "private_ip":
        return 403;
      case "timeout":
        return 504;
      default:
        return 502;
    }
  }
}

function allowedHostSuffixes(extra?: string): string[] {
  const raw = extra ?? process.env.ICAL_ALLOWED_HOSTS ?? "";
  const fromEnv = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...fromEnv];
}

function hostAllowed(hostname: string, suffixes: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

/**
 * Validate scheme + host against the whitelist. Pure (no IO) — also re-run on every
 * redirect hop so a 30x cannot escape the whitelist. Throws {@link IcalFetchError}.
 */
export function assertAllowedFeedUrl(rawUrl: string, opts: { allowedHosts?: string } = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new IcalFetchError("bad_url", "Invalid feed URL");
  }
  if (url.protocol !== "https:") throw new IcalFetchError("not_https", "Only https:// feeds are allowed");
  if (!hostAllowed(url.hostname, allowedHostSuffixes(opts.allowedHosts)))
    throw new IcalFetchError("host_not_allowed", `Feed host not allowed: ${url.hostname}`);
  return url;
}

/**
 * True for loopback/private/link-local addresses (the SSRF deny-list): IPv4 127/8, 10/8,
 * 0/8, 169.254/16, 172.16–31/12, 192.168/16; IPv6 ::1, fc00::/7 (fc/fd), fe80::/10; and
 * IPv4-mapped IPv6. A malformed literal is treated as unsafe (fail closed).
 */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return isPrivateIp(mapped[1]!);

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr)) {
    const parts = addr.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique-local fc00::/7
  if (addr.startsWith("fe80")) return true; // link-local
  return false;
}

export interface FetchFeedOptions {
  /** Extra comma-separated allowed host suffixes (defaults to ICAL_ALLOWED_HOSTS). */
  allowedHosts?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Injectable DNS resolver (tests). Returns the resolved A/AAAA addresses. */
  lookup?: (hostname: string) => Promise<string[]>;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const dns = await import("node:dns/promises");
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

/** Reject if the host resolves to a private/loopback IP. Fails OPEN on DNS error — the
 *  host whitelist is the primary gate (matches Narthex resolveAndCheck). */
async function assertPublicHost(hostname: string, lookup: (h: string) => Promise<string[]>): Promise<void> {
  if (isPrivateIp(hostname)) throw new IcalFetchError("private_ip", `Refusing address ${hostname}`);
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return; // DNS unavailable → fail open
  }
  for (const ip of addresses) {
    if (isPrivateIp(ip)) throw new IcalFetchError("private_ip", `Feed host resolves to private address ${ip}`);
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Server-side fetch of an iCal feed with the full Narthex hardening: HTTPS-only, host
 * whitelist, SSRF/private-IP rejection (re-checked on every redirect hop), a 10 s timeout,
 * and a 5 MB streamed cap. Returns the raw `text/calendar` body. Throws IcalFetchError.
 */
export async function fetchFeed(rawUrl: string, opts: FetchFeedOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookup = opts.lookup ?? defaultLookup;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = assertAllowedFeedUrl(rawUrl, { allowedHosts: opts.allowedHosts });
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECTS) throw new IcalFetchError("fetch_failed", "Too many redirects");
      await assertPublicHost(url.hostname, lookup);

      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          signal: controller.signal,
          redirect: "manual",
          headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new IcalFetchError("timeout", "Feed fetch timed out");
        throw new IcalFetchError("fetch_failed", `Feed fetch failed: ${(err as Error).message}`);
      }

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        if (!location) throw new IcalFetchError("fetch_failed", "Redirect without Location");
        // Re-validate the next hop against the whitelist before following it.
        url = assertAllowedFeedUrl(new URL(location, url).toString(), { allowedHosts: opts.allowedHosts });
        continue;
      }
      if (!res.ok) throw new IcalFetchError("fetch_failed", `Upstream responded ${res.status}`);
      return await readCapped(res, maxBytes);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body, aborting once it exceeds `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new IcalFetchError("too_large", "Feed exceeds the size limit");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IcalFetchError("too_large", "Feed exceeds the size limit");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

// ─── parseIcal — VEVENT → MergedEvent[], RRULE/EXDATE expanded to the visible window ──

export interface ParseIcalOptions {
  /** Display + filter label (the source name). */
  source: string;
  color?: string | null;
  /** Visible window, inclusive — the current month ± 1 month. */
  rangeStart: ISODate;
  rangeEnd: ISODate;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}
function isoFromYMD(y: number, m: number, d: number): ISODate {
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}
function icalTimeToDate(t: ICAL.Time): ISODate {
  return isoFromYMD(t.year, t.month, t.day);
}
/** A UTC Date for an ISODate at the given wall-clock — the floating space rrule expands in. */
function utcDate(date: ISODate, hour: number, minute: number, second: number): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hour, minute, second));
}

/**
 * Parse an iCal document into normalized {@link MergedEvent}s. Recurring events are
 * expanded to occurrences within [rangeStart, rangeEnd] via `rrule` (DTSTART+RRULE,
 * `between(...)`), honoring EXDATE; on any RRULE error the event falls back to a single
 * instance. Non-recurring events are included when they overlap the window. A malformed
 * document yields []; a malformed VEVENT is skipped without losing the rest.
 */
export function parseIcal(icsText: string, opts: ParseIcalOptions): MergedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(icsText));
  } catch {
    return [];
  }
  const out: MergedEvent[] = [];
  let index = 0;
  for (const ve of root.getAllSubcomponents("vevent")) {
    try {
      index = appendVevent(ve, opts, out, index);
    } catch {
      // Skip a single malformed VEVENT; keep the rest of the feed.
    }
  }
  return out;
}

interface Occurrence {
  date: ISODate;
  time: TimeOfDay | null; // null ⇒ all-day
}

function appendVevent(ve: ICAL.Component, opts: ParseIcalOptions, out: MergedEvent[], startIndex: number): number {
  const event = new ICAL.Event(ve);
  const dtstart = event.startDate;
  if (!dtstart) return startIndex;

  const allDay = dtstart.isDate;
  const title = (event.summary || "(untitled)").toString();
  const location = event.location ? event.location.toString() : null;
  const description = event.description ? event.description.toString() : null;
  const durationMin = durationMinutes(event);
  const baseTime: TimeOfDay = { hour: dtstart.hour, minute: dtstart.minute };

  const rrule = ve.getFirstPropertyValue("rrule");
  let occurrences: Occurrence[];
  if (rrule) {
    try {
      occurrences = expandRecurring(dtstart, rrule, ve, allDay, baseTime, opts);
    } catch {
      occurrences = singleOccurrence(dtstart, allDay, baseTime, durationMin, opts);
    }
  } else {
    occurrences = singleOccurrence(dtstart, allDay, baseTime, durationMin, opts);
  }

  let i = startIndex;
  for (const occ of occurrences) {
    out.push(buildEvent(opts, i++, occ, allDay, durationMin, title, location, description));
  }
  return i;
}

function durationMinutes(event: ICAL.Event): number {
  try {
    const seconds = event.duration?.toSeconds?.();
    if (typeof seconds === "number" && seconds > 0) return Math.round(seconds / 60);
  } catch {
    // fall through to default
  }
  return 60; // Narthex default 1h
}

/** A non-recurring event, kept only when it overlaps the visible window. */
function singleOccurrence(
  dtstart: ICAL.Time,
  allDay: boolean,
  baseTime: TimeOfDay,
  durationMin: number,
  opts: ParseIcalOptions,
): Occurrence[] {
  const date = icalTimeToDate(dtstart);
  if (compareDates(date, opts.rangeEnd) > 0) return [];
  const endDate = allDay ? date : addMinutes(date, baseTime, durationMin).date;
  if (compareDates(endDate, opts.rangeStart) < 0) return [];
  return [{ date, time: allDay ? null : baseTime }];
}

function expandRecurring(
  dtstart: ICAL.Time,
  rrule: unknown,
  ve: ICAL.Component,
  allDay: boolean,
  baseTime: TimeOfDay,
  opts: ParseIcalOptions,
): Occurrence[] {
  const rruleText = String((rrule as { toString(): string }).toString());
  const rule = rrulestr(`DTSTART:${dtstart.toICALString()}\nRRULE:${rruleText}`);
  const after = utcDate(opts.rangeStart, 0, 0, 0);
  const before = utcDate(opts.rangeEnd, 23, 59, 59);
  const dates = (rule as RRule).between(after, before, true);
  const exdates = collectExdates(ve);

  const occurrences: Occurrence[] = [];
  for (const d of dates) {
    const date = isoFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (exdates.has(date)) continue;
    occurrences.push({ date, time: allDay ? null : { hour: d.getUTCHours(), minute: d.getUTCMinutes() } });
  }
  // Keep the wall-clock from DTSTART for non-all-day rules whose freq doesn't shift time.
  if (!allDay) for (const occ of occurrences) occ.time ??= baseTime;
  return occurrences;
}

function collectExdates(ve: ICAL.Component): Set<ISODate> {
  const set = new Set<ISODate>();
  for (const prop of ve.getAllProperties("exdate")) {
    for (const v of prop.getValues()) {
      if (v && typeof v === "object" && "year" in (v as object)) {
        set.add(icalTimeToDate(v as ICAL.Time));
      }
    }
  }
  return set;
}

function buildEvent(
  opts: ParseIcalOptions,
  index: number,
  occ: Occurrence,
  allDay: boolean,
  durationMin: number,
  title: string,
  location: string | null,
  description: string | null,
): MergedEvent {
  let start: string;
  let end: string;
  if (allDay || !occ.time) {
    start = occ.date;
    end = occ.date;
  } else {
    start = localDateTime(occ.date, occ.time);
    const e = addMinutes(occ.date, occ.time, durationMin);
    end = localDateTime(e.date, e.time);
  }
  return {
    key: `ical-${opts.source}-${index}`,
    title,
    start,
    end,
    allDay: allDay,
    kind: "ical",
    source: opts.source,
    color: opts.color ?? null,
    location,
    description,
    isGhost: false,
    dbEventId: null,
  };
}

/** The visible window for the calendar: the given month ± 1 month (inclusive), as a
 *  [rangeStart, rangeEnd] pair of calendar dates. `anchor` is any date in the month —
 *  navigating months re-derives the window so feeds re-expand (Narthex behavior). */
export function monthWindow(anchor: ISODate): { rangeStart: ISODate; rangeEnd: ISODate } {
  const [y, m] = anchor.split("-").map(Number) as [number, number, number];
  return {
    rangeStart: monthStart(y, m, -1), // first day of the previous month
    rangeEnd: addDays(monthStart(y, m, 2), -1), // last day of the next month
  };
}

/** First day of the month `deltaMonths` away from (y, m=1..12), normalized across years. */
function monthStart(y: number, m: number, deltaMonths: number): ISODate {
  const total = y * 12 + (m - 1) + deltaMonths;
  return isoFromYMD(Math.floor(total / 12), (total % 12) + 1, 1);
}
