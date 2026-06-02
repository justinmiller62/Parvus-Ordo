import { describe, expect, it } from "vitest";
import { IcalFetchError, assertAllowedFeedUrl, fetchFeed, isPrivateIp, monthWindow, parseIcal } from "./ical";

const ics = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...lines, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

// A public-looking resolver / fetch for the happy paths.
const publicLookup = async () => ["93.184.216.34"];
const okResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/calendar" } });

describe("assertAllowedFeedUrl", () => {
  it("accepts https whitelisted hosts and subdomains", () => {
    expect(assertAllowedFeedUrl("https://calendar.google.com/x.ics").hostname).toBe("calendar.google.com");
    expect(assertAllowedFeedUrl("https://www.calendar.google.com/x.ics").hostname).toBe("www.calendar.google.com");
    expect(assertAllowedFeedUrl("https://feeds.faithlife.com/a").hostname).toBe("feeds.faithlife.com");
  });

  it("rejects non-https with not_https", () => {
    expect(() => assertAllowedFeedUrl("http://calendar.google.com/x")).toThrowError(
      expect.objectContaining({ code: "not_https" }),
    );
  });

  it("rejects non-whitelisted hosts with host_not_allowed", () => {
    expect(() => assertAllowedFeedUrl("https://evil.example.com/x")).toThrowError(
      expect.objectContaining({ code: "host_not_allowed" }),
    );
    // A host that merely contains a whitelisted string is not a suffix match.
    expect(() => assertAllowedFeedUrl("https://calendar.google.com.evil.com/x")).toThrowError(
      expect.objectContaining({ code: "host_not_allowed" }),
    );
  });

  it("honors extra allowed hosts", () => {
    expect(assertAllowedFeedUrl("https://feeds.mydiocese.org/x", { allowedHosts: "mydiocese.org" }).hostname).toBe(
      "feeds.mydiocese.org",
    );
  });

  it("maps error codes to HTTP statuses", () => {
    const e = new IcalFetchError("host_not_allowed", "x");
    expect(e.httpStatus).toBe(403);
    expect(new IcalFetchError("not_https", "x").httpStatus).toBe(400);
    expect(new IcalFetchError("timeout", "x").httpStatus).toBe(504);
  });
});

describe("isPrivateIp", () => {
  it("flags loopback/private/link-local v4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "0.0.0.0"])
      expect(isPrivateIp(ip), ip).toBe(true);
  });
  it("flags private v6 and v4-mapped", () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"])
      expect(isPrivateIp(ip), ip).toBe(true);
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:2800:220:1::1"])
      expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("fetchFeed", () => {
  it("returns the body on the happy path", async () => {
    const body = ics(...vevent("UID:1", "SUMMARY:Hi", "DTSTART:20260115T190000"));
    const text = await fetchFeed("https://calendar.google.com/a.ics", {
      lookup: publicLookup,
      fetchImpl: async () => okResponse(body),
    });
    expect(text).toContain("SUMMARY:Hi");
  });

  it("rejects a non-whitelisted host before any fetch", async () => {
    let fetched = false;
    await expect(
      fetchFeed("https://evil.example.com/a", {
        lookup: publicLookup,
        fetchImpl: async () => {
          fetched = true;
          return okResponse("");
        },
      }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
    expect(fetched).toBe(false);
  });

  it("rejects when the host resolves to a private IP", async () => {
    await expect(
      fetchFeed("https://calendar.google.com/a", {
        lookup: async () => ["10.1.2.3"],
        fetchImpl: async () => okResponse(""),
      }),
    ).rejects.toMatchObject({ code: "private_ip" });
  });

  it("re-validates redirects against the whitelist", async () => {
    await expect(
      fetchFeed("https://calendar.google.com/a", {
        lookup: publicLookup,
        fetchImpl: async () =>
          new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal" } }),
      }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
  });

  it("aborts a feed that exceeds the size cap", async () => {
    const big = "X".repeat(1024);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 100; i++) c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    await expect(
      fetchFeed("https://calendar.google.com/a", {
        lookup: publicLookup,
        maxBytes: 2048,
        fetchImpl: async () => new Response(stream, { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("times out a slow feed", async () => {
    await expect(
      fetchFeed("https://calendar.google.com/a", {
        lookup: publicLookup,
        timeoutMs: 10,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("parseIcal", () => {
  const window = monthWindow("2026-01-15"); // [2025-12-01, 2026-02-28]

  it("derives the visible window as month ± 1", () => {
    expect(window).toEqual({ rangeStart: "2025-12-01", rangeEnd: "2026-02-28" });
  });

  it("parses a timed single event into a 1-hour block", () => {
    const events = parseIcal(ics(...vevent("UID:1", "SUMMARY:Easter Mass", "DTSTART:20260115T190000")), {
      source: "Parish",
      color: "#abc",
      ...window,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Easter Mass",
      start: "2026-01-15T19:00:00",
      end: "2026-01-15T20:00:00",
      allDay: false,
      kind: "ical",
      source: "Parish",
      color: "#abc",
    });
  });

  it("parses an all-day event", () => {
    const events = parseIcal(ics(...vevent("UID:2", "SUMMARY:Solemnity", "DTSTART;VALUE=DATE:20260116")), {
      source: "Diocese",
      ...window,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ allDay: true, start: "2026-01-16", end: "2026-01-16" });
  });

  it("expands an RRULE only within the window and honors EXDATE", () => {
    const events = parseIcal(
      ics(
        ...vevent(
          "UID:3",
          "SUMMARY:Weekly Adoration",
          "DTSTART:20260106T190000",
          "RRULE:FREQ=WEEKLY;COUNT=10",
          "EXDATE:20260120T190000",
        ),
      ),
      { source: "Parish", ...window },
    );
    const dates = events.map((e) => e.start.slice(0, 10)).sort();
    // COUNT=10 starts 2026-01-06; only those on/before 2026-02-28 survive the window,
    // minus the 2026-01-20 EXDATE → 7 occurrences, none in March.
    expect(dates).toEqual([
      "2026-01-06",
      "2026-01-13",
      "2026-01-27",
      "2026-02-03",
      "2026-02-10",
      "2026-02-17",
      "2026-02-24",
    ]);
    expect(dates).not.toContain("2026-01-20");
    expect(events.every((e) => e.start.endsWith("T19:00:00"))).toBe(true);
  });

  it("excludes events outside the window", () => {
    const events = parseIcal(ics(...vevent("UID:4", "SUMMARY:Far Future", "DTSTART:20260815T100000")), {
      source: "Parish",
      ...window,
    });
    expect(events).toHaveLength(0);
  });

  it("returns [] for a malformed document", () => {
    expect(parseIcal("not an ical document", { source: "X", ...window })).toEqual([]);
  });
});
