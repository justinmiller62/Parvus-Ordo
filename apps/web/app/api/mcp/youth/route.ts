import { NextResponse } from "next/server";
import { YOUTH_MCP_TOOLS, callYouthTool, validateMcpToken } from "@parvaordo/core";

// Streamable-HTTP MCP endpoint for the Youth Teaches PROJECT tools. Claude Desktop
// connects here (via mcp-remote) with the teen's MCP session token as a Bearer
// header. corpus_search / corpus_read come from the separate corpus MCP server.

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpc {
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

function result(id: JsonRpc["id"], value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result: value });
}
function error(id: JsonRpc["id"], code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? new URL(req.url).searchParams.get("token");
}

export async function POST(req: Request): Promise<Response> {
  let body: JsonRpc;
  try {
    body = (await req.json()) as JsonRpc;
  } catch {
    return error(null, -32700, "Parse error");
  }
  const { id, method, params } = body;

  // Notifications carry no id and expect no response body.
  if (method === "notifications/initialized") return new Response(null, { status: 202 });

  if (method === "initialize") {
    return result(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "parvus-youth-teaches", version: "0.1.0" },
    });
  }

  // Everything else requires a valid teen MCP session token.
  const token = bearerToken(req);
  const session = token ? await validateMcpToken(token) : null;
  if (!session) return error(id, -32001, "Invalid or expired MCP token", 401);

  if (method === "tools/list") return result(id, { tools: YOUTH_MCP_TOOLS });

  if (method === "tools/call") {
    const name = params?.name ?? "";
    const args = params?.arguments ?? {};
    try {
      const value = await callYouthTool(session, name, args);
      return result(id, { content: [{ type: "text", text: JSON.stringify(value) }] });
    } catch (e) {
      return result(id, {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "tool failed"}` }],
        isError: true,
      });
    }
  }

  return error(id, -32601, `Method not found: ${method ?? ""}`);
}
