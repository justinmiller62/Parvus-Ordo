import { YOUTH_MCP_TOOLS, callYouthTool, createMcpPostHandler, validateMcpToken } from "@parvaordo/core";

// Streamable-HTTP MCP endpoint for the Parvus Studio PROJECT tools. Claude Desktop
// connects here (via mcp-remote) with the teen's MCP session token as a Bearer
// header. corpus_search / corpus_read come from the separate corpus MCP server.
//
// The JSON-RPC 2.0 transport framing is shared via core's createMcpPostHandler;
// this route is just the studio server config (the corpus route will be another).
export const POST = createMcpPostHandler({
  serverInfo: { name: "parvus-studio", version: "0.1.0" },
  tools: YOUTH_MCP_TOOLS,
  validateToken: validateMcpToken,
  callTool: callYouthTool,
});
