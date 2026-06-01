import { setProjectStatus, updateScriptDraft } from "@parvaordo/core";
import { devBypassEnabled } from "@/src/lib/auth";

/**
 * Dev/test-only: reset a Parvus Studio project to a pristine drafting state
 * (empty script) so the parvus-studio spec is re-runnable across viewports.
 * Gated like /dev/login (non-production + AUTH_BYPASS=1).
 */
export async function GET(request: Request): Promise<Response> {
  if (!devBypassEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const project = url.searchParams.get("project");
  const parish = url.searchParams.get("parish");
  if (!project || !parish) {
    return new Response("project and parish query params required", { status: 400 });
  }
  await updateScriptDraft(parish, project, "");
  await setProjectStatus(parish, project, "drafting");
  return new Response("ok");
}
