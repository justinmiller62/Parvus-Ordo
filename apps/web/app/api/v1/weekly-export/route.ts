import { isStaff } from "@parvaordo/shared";
import { buildWeeklyExport, renderWeeklyExportMarkdown } from "@parvaordo/core";
import { authenticateApiRequest } from "@/src/lib/api-auth";

export const runtime = "nodejs";

// GET /api/v1/weekly-export?cohortId=<uuid>&week=<n>
//
// The programmatic twin of the teacher Weekly Export page — the SAME bundle
// (renderWeeklyExportMarkdown(buildWeeklyExport(...))), reproducing the page's posture at
// the boundary: bearer-authed, catechist/admin/super_admin ONLY, and parish-scoped. The
// cohort is read under the caller's own parish (getDb + RLS), so another parish's cohort is
// invisible → 404, matching the page's "this cohort isn't available". (Comprehensive
// bearer-auth integration coverage for /api/v1 is tracked in po-78ur.)
export async function GET(req: Request): Promise<Response> {
  const user = await authenticateApiRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaff(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const cohortId = params.get("cohortId");
  const week = Number(params.get("week"));
  if (!cohortId || !Number.isInteger(week) || week < 1) {
    return Response.json({ error: "cohortId and a positive integer week are required" }, { status: 400 });
  }

  const data = await buildWeeklyExport(user.parishId, { cohortId, week });
  // Empty cohortName ⇒ the cohort doesn't exist in this parish (or RLS hid it).
  if (!data.cohortName) return Response.json({ error: "cohort not found" }, { status: 404 });

  return new Response(renderWeeklyExportMarkdown(data), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
