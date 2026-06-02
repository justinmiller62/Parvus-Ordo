import { describe, expect, it } from "vitest";
import { createMcpPostHandler } from "./json-rpc";

// Unit coverage for the generic MCP JSON-RPC transport framing. Uses a stub
// config (fake tools + token validation + dispatch) so the test exercises ONLY
// the envelope: result/error shapes, initialize, notifications, auth gate, and
// tools/list + tools/call. Server-specific behaviour lives in each module's tools.

interface StubSession {
  who: string;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools: Record<string, unknown> };
    serverInfo?: { name: string; version: string };
    tools?: unknown[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

function handlerWith(overrides: Partial<Parameters<typeof createMcpPostHandler<StubSession>>[0]> = {}) {
  return createMcpPostHandler<StubSession>({
    serverInfo: { name: "stub-server", version: "9.9.9" },
    tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object" } }],
    validateToken: async (token) => (token === "good" ? { who: "teen" } : null),
    callTool: async (session, name, args) => {
      if (name === "boom") throw new Error("kaboom");
      return { name, who: session.who, args };
    },
    ...overrides,
  });
}

function post(handler: (req: Request) => Promise<Response>, body: unknown, init: RequestInit = {}) {
  return handler(
    new Request("https://parish.example/api/mcp/test", {
      method: "POST",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function rpc(res: Response): Promise<RpcResponse> {
  return (await res.json()) as RpcResponse;
}

describe("createMcpPostHandler", () => {
  it("returns a parse error for a malformed body (id null, code -32700)", async () => {
    const res = await post(handlerWith(), "{ not json");
    expect(res.status).toBe(200);
    expect(await rpc(res)).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("answers initialize with the configured serverInfo and echoes the client protocolVersion", async () => {
    const res = await post(handlerWith(), {
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2030-01-01" },
    });
    expect(res.status).toBe(200);
    expect(await rpc(res)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2030-01-01",
        capabilities: { tools: {} },
        serverInfo: { name: "stub-server", version: "9.9.9" },
      },
    });
  });

  it("falls back to the default protocol version when the client omits it", async () => {
    const res = await post(handlerWith(), { id: 1, method: "initialize" });
    expect((await rpc(res)).result?.protocolVersion).toBe("2024-11-05");
  });

  it("acks notifications/initialized with an empty 202 and no body", async () => {
    const res = await post(handlerWith(), { method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("rejects an unauthenticated tools/list with 401 / code -32001", async () => {
    const res = await post(handlerWith(), { id: 2, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(await rpc(res)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32001, message: "Invalid or expired MCP token" },
    });
  });

  it("lists the configured tools for a valid bearer token", async () => {
    const res = await post(
      handlerWith(),
      { id: 3, method: "tools/list" },
      { headers: { authorization: "Bearer good" } },
    );
    expect(res.status).toBe(200);
    expect((await rpc(res)).result?.tools).toEqual([
      { name: "echo", description: "echoes", inputSchema: { type: "object" } },
    ]);
  });

  it("accepts the token from the ?token= query param as well as the Authorization header", async () => {
    const handler = handlerWith();
    const res = await handler(
      new Request("https://parish.example/api/mcp/test?token=good", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 4, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await rpc(res)).result?.tools).toHaveLength(1);
  });

  it("dispatches tools/call and wraps the result as MCP text content", async () => {
    const res = await post(
      handlerWith(),
      { id: 5, method: "tools/call", params: { name: "echo", arguments: { x: 1 } } },
      { headers: { authorization: "Bearer good" } },
    );
    expect(res.status).toBe(200);
    const json = await rpc(res);
    expect(json.id).toBe(5);
    expect(json.result?.isError).toBeUndefined();
    expect(JSON.parse(json.result?.content?.[0]?.text ?? "null")).toEqual({
      name: "echo",
      who: "teen",
      args: { x: 1 },
    });
  });

  it("returns a thrown tool error as an isError result (not a JSON-RPC error)", async () => {
    const res = await post(
      handlerWith(),
      { id: 6, method: "tools/call", params: { name: "boom" } },
      { headers: { authorization: "Bearer good" } },
    );
    expect(res.status).toBe(200);
    const json = await rpc(res);
    expect(json.error).toBeUndefined();
    expect(json.result?.isError).toBe(true);
    expect(json.result?.content?.[0]?.text).toBe("Error: kaboom");
  });

  it("reports unknown methods with code -32601", async () => {
    const res = await post(
      handlerWith(),
      { id: 7, method: "tools/nope" },
      { headers: { authorization: "Bearer good" } },
    );
    const json = await rpc(res);
    expect(json.error?.code).toBe(-32601);
    expect(json.error?.message).toBe("Method not found: tools/nope");
  });
});
