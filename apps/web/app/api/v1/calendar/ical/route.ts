import { NextResponse } from "next/server";
import { IcalFetchError, fetchFeed } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

export const runtime = "nodejs";

// proxy-ical — fetch an external iCal feed server-side. Browsers can't fetch arbitrary
// cross-origin ICS (CORS), and outbound fetches need a host whitelist + SSRF guard; both
// live in core/calendar/ical.fetchFeed. This REPLACES the Narthex proxy-ical Edge
// Function and deliberately does NOT carry over its hardcoded service_role JWT — auth is
// the WorkOS session (any authenticated parish member, since students view the calendar).
export async function GET(req: Request): Promise<Response> {
  const viewer = await getViewer();
  const parishId = viewer?.identity?.parishId;
  if (!parishId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  try {
    const body = await fetchFeed(url);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // 10-minute CDN cache (Narthex parity) — feeds are read-only, range-bounded.
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (err) {
    if (err instanceof IcalFetchError) return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    return NextResponse.json({ error: "feed_error" }, { status: 502 });
  }
}
