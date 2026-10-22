// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
// Implements: initialize, ping, tools/list, tools/call.

import { TOOLS, TOOLS_BY_NAME, validateArgs } from "./tools.js";

export const SERVER_INFO = { name: "pdga-mcp", title: "PDGA Disc Golf", version: "0.1.0" };
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "Tools for the PDGA (Professional Disc Golf Association) public data API: players, ratings, yearly " +
  "player statistics, sanctioned events, and the course directory. The API has no event results or round " +
  "scores. When showing PDGA data, include the pdga_url links and credit the PDGA as the data source.";

export function createServer({ client, log = () => {} }) {
  async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;

    try {
      switch (method) {
        case "initialize": {
          const requested = params?.protocolVersion;
          const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, {
            tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
              name,
              title,
              description,
              inputSchema,
              annotations,
            })),
          });
        case "tools/call":
          return ok(id, await callTool(params));
        default:
          if (method?.startsWith("notifications/")) return null; // notifications need no reply
          return isRequest ? err(id, -32601, `Method not found: ${method}`) : null;
      }
    } catch (e) {
      log(`error handling ${method}: ${e?.stack ?? e}`);
      return isRequest ? err(id, -32603, e?.message ?? "Internal error") : null;
    }
  }

  async function callTool(params) {
    const name = params?.name;
    const tool = TOOLS_BY_NAME[name];
    if (!tool) return toolError(`Unknown tool: ${name}`);

    const args = params?.arguments ?? {};
    const problem = validateArgs(tool.inputSchema, args);
    if (problem) return toolError(`Invalid arguments for ${name}: ${problem}`);

    try {
      const result = await tool.handler(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (e) {
      log(`tool ${name} failed: ${e?.stack ?? e}`);
      return toolError(e?.message ?? String(e));
    }
  }

  return { handle };
}

function ok(id, result) {
  return id === undefined || id === null ? null : { jsonrpc: "2.0", id, result };
}

function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Wire a server to stdin/stdout. Each message is one line of JSON.
export function runStdio(server, { input = process.stdin, output = process.stdout, log } = {}) {
  let buffer = "";
  const write = (obj) => output.write(JSON.stringify(obj) + "\n");

  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      dispatch(line);
    }
  });

  async function dispatch(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write(err(null, -32700, "Parse error"));
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) {
      const reply = await server.handle(m);
      if (reply) write(reply);
    }
  }

  return new Promise((resolve) => input.on("end", resolve));
}
