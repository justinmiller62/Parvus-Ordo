import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { devBypassEnabled, setDevUser } from "@/src/lib/auth";
import { ACTIVE_PARISH_COOKIE } from "@/src/lib/viewer";

/**
 * Dev/test-only sign-in bypass:
 *   /dev/login?email=admin@parvaordo.test[&parish=<parishId>][&redirect=/path]
 * `parish` sets the active parish (skips the chooser for a multi-parish user);
 * omitting it clears the choice, so a multi-parish user lands on the chooser.
 * 404s unless the bypass is enabled (non-production + AUTH_BYPASS=1).
 */
export async function GET(request: Request): Promise<Response> {
  if (!devBypassEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return new Response("email query param required", { status: 400 });
  }

  await setDevUser(email);
  const parish = url.searchParams.get("parish");
  const jar = await cookies();
  if (parish) jar.set(ACTIVE_PARISH_COOKIE, parish, { httpOnly: true, sameSite: "lax", path: "/" });
  else jar.delete(ACTIVE_PARISH_COOKIE);
  redirect(url.searchParams.get("redirect") ?? "/");
}
