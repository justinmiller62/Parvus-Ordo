// Generic MCP JSON-RPC 2.0 Streamable-HTTP transport framing, shared by every
// Parvus MCP route (the Parvus Studio project tools, the corpus server, …).
// A route supplies only its serverInfo + tool list + token validation + dispatch;
// this owns the protocol envelope: result/error wrappers, the initialize /
// notifications/initialized handshake, bearer-or-query token extraction, and the
// tools/list + tools/call methods. Framework-agnostic apart from the Web
// `Request`/`Response` globals, so a route handler becomes a thin config.

const PROTOCOL_VERSION = "2024-11-05";

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpRouteConfig<TSession> {
  /** Advertised to the client during the initialize handshake. */
  serverInfo: McpServerInfo;
  /** Tool schemas echoed verbatim from tools/list (e.g. a module's MCP_TOOLS). */
  tools: readonly unknown[];
  /** Validate the bearer/query token → a session, or null to reject with 401. */
  validateToken: (token: string) => Promise<TSession | null>;
  /** Dispatch a validated tools/call; a thrown error becomes an MCP isError result. */
  callTool: (session: TSession, name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface JsonRpc {
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

function jsonRpc(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function result(id: JsonRpc["id"], value: unknown): Response {
  return jsonRpc({ jsonrpc: "2.0", id: id ?? null, result: value });
}
function error(id: JsonRpc["id"], code: number, message: string, status = 200): Response {
  return jsonRpc({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? new URL(req.url).searchParams.get("token");
}

/**
 * Build a POST handler implementing the MCP Streamable-HTTP JSON-RPC envelope for
 * a given server config. Mount it from a route as `export const POST = createMcpPostHandler({…})`.
 */
export function createMcpPostHandler<TSession>(config: McpRouteConfig<TSession>) {
  return async function POST(req: Request): Promise<Response> {
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
        serverInfo: config.serverInfo,
      });
    }

    // Everything else requires a valid session token.
    const token = bearerToken(req);
    const session = token ? await config.validateToken(token) : null;
    if (!session) return error(id, -32001, "Invalid or expired MCP token", 401);

    if (method === "tools/list") return result(id, { tools: config.tools });

    if (method === "tools/call") {
      const name = params?.name ?? "";
      const args = params?.arguments ?? {};
      try {
        const value = await config.callTool(session, name, args);
        return result(id, { content: [{ type: "text", text: JSON.stringify(value) }] });
      } catch (e) {
        return result(id, {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "tool failed"}` }],
          isError: true,
        });
      }
    }

    return error(id, -32601, `Method not found: ${method ?? ""}`);
  };
}
