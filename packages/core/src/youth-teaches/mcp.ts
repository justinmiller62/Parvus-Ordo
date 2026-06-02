import { createHash } from "node:crypto";
import { getDb } from "../db/client";
import { assertOwnsProject } from "./ownership";
import { getProjectDetails, listMyProjects, saveCorpusPassage, updateScriptDraft } from "./projects";
import { addProjectSlide } from "./slides";

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

/** Look a token up (pre-tenant-context) via the SECURITY DEFINER validator. */
async function loadMcpSession(token: string): Promise<McpSession | null> {
  const { rows } = await getDb(null).query<{ parish_id: string; teen_user_id: string }>(
    "SELECT parish_id, teen_user_id FROM validate_youth_mcp_token($1)",
    [token],
  );
  const r = rows[0];
  return r ? { parishId: r.parish_id, teenUserId: r.teen_user_id } : null;
}

// In-process cache of validated MCP sessions, keyed by a hash of the Bearer token.
// Claude Desktop fires many tools/call messages per chat turn, each of which used to
// re-run the validate_youth_mcp_token SECURITY DEFINER function — one pool connection +
// transaction per message, contending with page traffic for the shared 10-connection
// pool. Caching token→session for a short TTL keeps the DB out of the hot per-message
// path. Only VALID sessions are cached, so a flood of bad tokens can't grow the cache;
// the TTL bounds how long an already-expired token keeps working to at most the TTL
// (the validator still re-checks expiry on every miss). The cache is process-local and
// rebuildable — purely a DB-load optimisation, never the source of truth.
const MCP_SESSION_CACHE_TTL_MS = 60_000;
const MCP_SESSION_CACHE_MAX = 10_000;
const mcpSessionCache = new Map<string, { session: McpSession; expiresAtMs: number }>();

/** Hash the token so raw bearer secrets aren't held as live cache keys. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Drop expired entries; if all are still live, evict the oldest (Map keeps insertion order). */
function evictMcpSessions(nowMs: number): void {
  for (const [k, e] of mcpSessionCache) {
    if (e.expiresAtMs <= nowMs) mcpSessionCache.delete(k);
  }
  if (mcpSessionCache.size >= MCP_SESSION_CACHE_MAX) {
    const oldest = mcpSessionCache.keys().next().value;
    if (oldest !== undefined) mcpSessionCache.delete(oldest);
  }
}

/**
 * Validate an MCP token → its session, served from a short-lived in-process cache so the
 * per-message MCP hot path doesn't re-hit the DB validator on every tools/call. `load`
 * and `now` are injectable for tests; production uses the real validator + system clock.
 */
export async function validateMcpToken(
  token: string,
  load: (token: string) => Promise<McpSession | null> = loadMcpSession,
  now: () => number = Date.now,
): Promise<McpSession | null> {
  if (!token) return null;
  const key = hashToken(token);
  const nowMs = now();

  const hit = mcpSessionCache.get(key);
  if (hit) {
    if (hit.expiresAtMs > nowMs) return hit.session;
    mcpSessionCache.delete(key); // expired — fall through and re-validate
  }

  const session = await load(token);
  if (!session) return null; // never cache a miss — bad tokens must not bloat the cache

  if (mcpSessionCache.size >= MCP_SESSION_CACHE_MAX) evictMcpSessions(nowMs);
  mcpSessionCache.set(key, { session, expiresAtMs: nowMs + MCP_SESSION_CACHE_TTL_MS });
  return session;
}

async function logMcpTool(
  parishId: string,
  projectId: string | null,
  toolName: string,
  params: unknown,
): Promise<void> {
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
    description:
      "Get a project's details: title, topic, age band, current script text, the common misconception, and the correct teaching.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_script_draft",
    description:
      "Replace the project's script draft with new text. Returns the new word count and estimated speaking time.",
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
      "Upload a teaching slide image to the project. Provide the image itself as base64-encoded bytes in image_base64. Slides MUST be 1920×1080 (16:9, landscape) PNGs — that is the recording aspect ratio. slide_order is 1-based; uploading to an order that already exists replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        slide_order: { type: "number", description: "1-based slide position" },
        image_base64: { type: "string", description: "base64-encoded bytes of a 1920×1080 PNG" },
        content_type: { type: "string", description: "image MIME type; defaults to image/png" },
      },
      required: ["project_id", "slide_order", "image_base64"],
      additionalProperties: false,
    },
  },
] as const;

/** Dispatch an MCP tool call within a validated session; logs every call. */
export async function callYouthTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { parishId, teenUserId } = session;
  switch (name) {
    case "list_my_projects": {
      await logMcpTool(parishId, null, name, args);
      return { projects: await listMyProjects(parishId, teenUserId) };
    }
    case "get_project_details": {
      const projectId = String(args.project_id);
      await assertOwnsProject(parishId, teenUserId, projectId);
      await logMcpTool(parishId, projectId, name, args);
      const details = await getProjectDetails(parishId, projectId);
      if (!details) throw new Error("project not found");
      return details;
    }
    case "update_script_draft": {
      const projectId = String(args.project_id);
      await assertOwnsProject(parishId, teenUserId, projectId);
      await logMcpTool(parishId, projectId, name, {
        project_id: projectId,
        new_text_length: String(args.new_text ?? "").length,
      });
      return updateScriptDraft(parishId, projectId, String(args.new_text ?? ""));
    }
    case "save_corpus_passage": {
      const projectId = String(args.project_id);
      await assertOwnsProject(parishId, teenUserId, projectId);
      await logMcpTool(parishId, projectId, name, args);
      return saveCorpusPassage(parishId, projectId, String(args.citation), args.notes ? String(args.notes) : undefined);
    }
    case "upload_slide": {
      const projectId = String(args.project_id);
      await assertOwnsProject(parishId, teenUserId, projectId);
      const order = Number(args.slide_order);
      await logMcpTool(parishId, projectId, name, { project_id: projectId, slide_order: order });
      const bytes = new Uint8Array(Buffer.from(String(args.image_base64 ?? ""), "base64"));
      if (bytes.byteLength === 0) throw new Error("image_base64 is required (base64-encoded image bytes)");
      const contentType = args.content_type ? String(args.content_type) : "image/png";
      const { r2Key } = await addProjectSlide(parishId, projectId, order, bytes, contentType);
      return { ok: true, slide_order: order, r2_key: r2Key };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
