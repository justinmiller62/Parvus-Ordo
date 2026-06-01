import { getDb } from "../db/client";
import { getProjectDetails, listMyProjects, saveCorpusPassage, updateScriptDraft } from "./projects";
import { addProjectSlideFromUrl } from "./slides";

// The Youth Teaches MCP server exposes ONLY the project tools. corpus_search /
// corpus_read come from the separate (existing) corpus MCP server — Claude Desktop
// connects to both.

export interface McpSession {
  parishId: string;
  teenUserId: string;
}

/** Mint an MCP session token for a teen's "Start AI session". */
export async function mintMcpToken(
  parishId: string,
  teenUserId: string,
  ttlMinutes = 120,
): Promise<{ token: string; expiresAt: string }> {
  const token = `mcp_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await getDb(parishId).query(
    "INSERT INTO youth_mcp_tokens (parish_id, teen_user_id, token, expires_at) VALUES ($1, $2, $3, $4)",
    [parishId, teenUserId, token, expiresAt],
  );
  return { token, expiresAt };
}

/** Validate an MCP token (pre-tenant-context) via the SECURITY DEFINER function. */
export async function validateMcpToken(token: string): Promise<McpSession | null> {
  if (!token) return null;
  const { rows } = await getDb(null).query<{ parish_id: string; teen_user_id: string }>(
    "SELECT parish_id, teen_user_id FROM validate_youth_mcp_token($1)",
    [token],
  );
  const r = rows[0];
  return r ? { parishId: r.parish_id, teenUserId: r.teen_user_id } : null;
}

async function logMcpTool(parishId: string, projectId: string | null, toolName: string, params: unknown): Promise<void> {
  await getDb(parishId).query(
    "INSERT INTO youth_mcp_audit_log (parish_id, project_id, tool_name, params) VALUES ($1, $2, $3, $4::jsonb)",
    [parishId, projectId, toolName, JSON.stringify(params ?? {})],
  );
}

/** Tool schemas advertised to Claude Desktop (MCP listTools). */
export const YOUTH_MCP_TOOLS = [
  {
    name: "list_my_projects",
    description: "List the teen's Youth Teaches projects (id, title, status, topic category).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project_details",
    description: "Get a project's details: title, topic, age band, current script text, the common misconception, and the correct teaching.",
    inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"], additionalProperties: false },
  },
  {
    name: "update_script_draft",
    description: "Replace the project's script draft with new text. Returns the new word count and estimated speaking time.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, new_text: { type: "string" } },
      required: ["project_id", "new_text"],
      additionalProperties: false,
    },
  },
  {
    name: "save_corpus_passage",
    description: "Save a corpus citation (with optional notes) to the project for reference while writing.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, citation: { type: "string" }, notes: { type: "string" } },
      required: ["project_id", "citation"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_slide",
    description:
      "Add a teaching slide to the project from a public image URL. Slides MUST be 1920×1080 (16:9, landscape) — that is the recording aspect ratio. slide_order is 1-based; uploading to an order that already exists replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        slide_order: { type: "number", description: "1-based slide position" },
        image_url: { type: "string", description: "public URL of a 1920×1080 PNG/JPG" },
      },
      required: ["project_id", "slide_order", "image_url"],
      additionalProperties: false,
    },
  },
] as const;

/** Dispatch an MCP tool call within a validated session; logs every call. */
export async function callYouthTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { parishId, teenUserId } = session;
  switch (name) {
    case "list_my_projects": {
      await logMcpTool(parishId, null, name, args);
      return { projects: await listMyProjects(parishId, teenUserId) };
    }
    case "get_project_details": {
      const projectId = String(args.project_id);
      await logMcpTool(parishId, projectId, name, args);
      const details = await getProjectDetails(parishId, projectId);
      if (!details) throw new Error("project not found");
      return details;
    }
    case "update_script_draft": {
      const projectId = String(args.project_id);
      await logMcpTool(parishId, projectId, name, { project_id: projectId, new_text_length: String(args.new_text ?? "").length });
      return updateScriptDraft(parishId, projectId, String(args.new_text ?? ""));
    }
    case "save_corpus_passage": {
      const projectId = String(args.project_id);
      await logMcpTool(parishId, projectId, name, args);
      return saveCorpusPassage(parishId, projectId, String(args.citation), args.notes ? String(args.notes) : undefined);
    }
    case "upload_slide": {
      const projectId = String(args.project_id);
      const order = Number(args.slide_order);
      await logMcpTool(parishId, projectId, name, { project_id: projectId, slide_order: order });
      const { r2Key } = await addProjectSlideFromUrl(parishId, projectId, order, String(args.image_url));
      return { ok: true, slide_order: order, r2_key: r2Key };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
