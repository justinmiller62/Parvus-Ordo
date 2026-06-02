import { authenticateWithPassword, signApiToken } from "@parvaordo/core";

// POST /api/v1/auth/login — email+password → app token (Parvus Studio iOS).
// Body: { email, password }. 200 → { jwt, user_id, display_name, expires_at }; 401 invalid.
export async function POST(req: Request): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) return Response.json({ error: "email and password are required" }, { status: 400 });

  const user = await authenticateWithPassword(email, password);
  if (!user) return Response.json({ error: "invalid credentials" }, { status: 401 });

  const { jwt, expiresAt } = await signApiToken({ userId: user.userId, email: user.email, parishId: user.parishId });
  return Response.json({
    jwt,
    user_id: user.userId,
    display_name: user.displayName,
    expires_at: expiresAt,
  });
}
