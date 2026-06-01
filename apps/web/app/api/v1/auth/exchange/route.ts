import { authenticateWithCode, signApiToken } from "@parvaordo/core";

// POST /api/v1/auth/exchange — trade a WorkOS authorization code (from the hosted
// OAuth / Google flow, delivered to parvusstudio://callback?code=…) for an app token.
// Body: { code }. 200 → { jwt, user_id, display_name, expires_at }; 401 bad/expired code.
export async function POST(req: Request): Promise<Response> {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const code = (body.code ?? "").trim();
  if (!code) return Response.json({ error: "code is required" }, { status: 400 });

  const user = await authenticateWithCode(code);
  if (!user) return Response.json({ error: "invalid or expired code" }, { status: 401 });

  const { jwt, expiresAt } = await signApiToken({ userId: user.userId, email: user.email });
  return Response.json({
    jwt,
    user_id: user.userId,
    display_name: user.displayName,
    expires_at: expiresAt,
  });
}
