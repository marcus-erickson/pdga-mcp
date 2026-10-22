#!/usr/bin/env node
// Entry point: PDGA MCP server over stdio.
// Credentials come from the environment: PDGA_USERNAME, PDGA_PASSWORD (optional PDGA_BASE_URL).

import { PdgaClient } from "./pdga-client.js";
import { createServer, runStdio } from "./mcp.js";

// stdout is the protocol channel, so all logging goes to stderr.
const log = (...args) => console.error("[pdga-mcp]", ...args);

let client;
try {
  client = new PdgaClient({
    username: process.env.PDGA_USERNAME,
    password: process.env.PDGA_PASSWORD,
    baseUrl: process.env.PDGA_BASE_URL || undefined,
  });
} catch (e) {
  log(e.message);
  process.exit(1);
}

const server = createServer({ client, log });

const shutdown = async () => {
  await client.logout();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("ready");
await runStdio(server, { log });
await client.logout();
