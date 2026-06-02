import { lookupAppUser } from "../platform/identity";

// WorkOS-backed login for the iOS app. We don't store credentials — WorkOS does.
// Two grants land here: password (email+password) and authorization_code (the
// hosted OAuth / Google flow). Both verify with WorkOS, then resolve our local
// user + parish; the route turns the result into a 30-day app token.

export interface PasswordLoginResult {
  userId: string;
  email: string;
  displayName: string;
  parishId: string;
}

/** Shared tail: resolve a WorkOS-verified email to our app user + parish. */
async function resolveLogin(email: string | null | undefined): Promise<PasswordLoginResult | null> {
  if (!email) return null;
  const id = await lookupAppUser(email);
  if (!id?.parishId) return null; // authenticated, but not a member of any parish
  return { userId: id.userId, email, displayName: id.displayName, parishId: id.parishId };
}

async function workosAuthenticate(extra: Record<string, string>): Promise<string | null> {
  const clientId = process.env.WORKOS_CLIENT_ID;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!clientId || !apiKey) throw new Error("WorkOS is not configured (WORKOS_CLIENT_ID / WORKOS_API_KEY)");
  const res = await fetch("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: apiKey, ...extra }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: { email?: string } };
  return data.user?.email ?? null;
}

/** Verify email+password against WorkOS, then map to our app user. Returns null on
 * bad credentials or a user with no parish membership. (Password users only —
 * Google/SSO accounts have no password; use authenticateWithCode for those.) */
export async function authenticateWithPassword(email: string, password: string): Promise<PasswordLoginResult | null> {
  const verified = await workosAuthenticate({ grant_type: "password", email: email.trim().toLowerCase(), password });
  // Resolve ONLY the WorkOS-verified email. Never fall back to the request-body
  // email: workosAuthenticate returns null when WorkOS rejects the credentials, and
  // a `?? email` fallback would mint a token for any parish email + any password
  // (account takeover). authenticateWithCode passes `verified` for the same reason.
  return resolveLogin(verified);
}

/** Exchange a WorkOS authorization code (from the hosted OAuth / Google flow) for
 * our app user. This is the path Google sign-in uses. Returns null on a bad/expired
 * code or a user with no parish membership. */
export async function authenticateWithCode(code: string): Promise<PasswordLoginResult | null> {
  const verified = await workosAuthenticate({ grant_type: "authorization_code", code });
  return resolveLogin(verified);
}
