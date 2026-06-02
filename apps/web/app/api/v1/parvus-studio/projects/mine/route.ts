import { listMyProjects } from "@parvaordo/core";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// GET /api/v1/parvus-studio/projects/mine — the signed-in teen's projects (iOS).
export async function GET(req: Request): Promise<Response> {
  const user = await authenticateApiRequest(req, "studio");
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const projects = await listMyProjects(user.parishId, user.userId);
  return Response.json({
    projects: projects.map((p) => ({ id: p.id, title: p.title, status: p.status, topic_category: p.topicCategory })),
  });
}
