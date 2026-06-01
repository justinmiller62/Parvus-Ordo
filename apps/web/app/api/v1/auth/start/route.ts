// GET /api/v1/auth/start — the WorkOS hosted-login URL for Parvus Studio (iOS).
// The app opens this in ASWebAuthenticationSession (callback scheme "parvusstudio");
// the hosted page shows Google + any other enabled methods. After sign-in WorkOS
// redirects to parvusstudio://callback?code=… → POST the code to /api/v1/auth/exchange.
//
// The redirect URI must be registered in the WorkOS dashboard (Redirect URIs).
const REDIRECT_URI = "parvusstudio://callback";

export async function GET(): Promise<Response> {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) return Response.json({ error: "auth not configured" }, { status: 500 });

  const url = new URL("https://api.workos.com/user_management/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("provider", "authkit"); // hosted login (Google + enabled methods)

  return Response.json({
    authorization_url: url.toString(),
    callback_url: REDIRECT_URI,
    callback_scheme: "parvusstudio",
  });
}
