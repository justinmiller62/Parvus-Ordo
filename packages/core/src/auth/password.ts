import { lookupAppUser } from "../platform/identity";

// Email+password login for the iOS app. We don't store passwords — WorkOS does.
// This proxies WorkOS User Management's password grant to verify credentials, then
// resolves our local user + parish. The route turns the result into an app token.

export interface PasswordLoginResult {
  userId: string;
  email: string;
  displayName: string;
  parishId: string;
}

/** Verify email+password against WorkOS, then map to our app user. Returns null on
 * bad credentials or a user with no parish membership. */
export async function authenticateWithPassword(email: string, password: string): Promise<PasswordLoginResult | null> {
  const clientId = process.env.WORKOS_CLIENT_ID;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!clientId || !apiKey) throw new Error("WorkOS is not configured (WORKOS_CLIENT_ID / WORKOS_API_KEY)");

  const res = await fetch("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: apiKey,
      grant_type: "password",
      email: email.trim().toLowerCase(),
      password,
    }),
  });
  if (!res.ok) return null; // invalid credentials / password auth disabled for this user

  const data = (await res.json()) as { user?: { email?: string } };
  const verifiedEmail = data.user?.email ?? email;
  const id = await lookupAppUser(verifiedEmail);
  if (!id?.parishId) return null; // authenticated, but not a member of any parish
  return { userId: id.userId, email: verifiedEmail, displayName: id.displayName, parishId: id.parishId };
}
