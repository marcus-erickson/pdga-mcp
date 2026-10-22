import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PdgaClient } from "../src/pdga-client.js";
import { createServer } from "../src/mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// A fake PDGA API that mimics the documented session flow.
function startMockPdga() {
  const state = { logins: 0, expireNext: false, requests: [] };
  const SESSION = "SSESSabc";
  let sessid = "sid1";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/services/json/user/login") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const { username, password } = JSON.parse(raw);
        if (username !== "marcus" || password !== "pw") return send(401, ["Wrong username or password."]);
        state.logins++;
        sessid = `sid${state.logins}`;
        send(200, { sessid, session_name: SESSION, token: "tok", user: { name: "marcus" } });
      });
      return;
    }
    if (url.pathname === "/services/json/user/logout") return send(200, [true]);

    if (req.headers.cookie !== `${SESSION}=${sessid}` || state.expireNext) {
      state.expireNext = false;
      return send(403, ["Access denied for user anonymous"]);
    }

    const q = url.searchParams;
    switch (url.pathname) {
      case "/services/json/players":
        return send(200, {
          status: 0,
          players:
            q.get("pdga_number") === "999999"
              ? []
              : [
                  {
                    first_name: "Paul",
                    last_name: "McBeth",
                    pdga_number: "27523",
                    membership_status: "current",
                    classification: "P",
                    city: "Huntington Beach",
                    state_prov: "CA",
                    country: "US",
                    rating: "1050",
                    official_status: "",
                  },
                ],
        });
      case "/services/json/player-statistics":
        return send(200, {
          status: 0,
          players: [
            {
              first_name: "Paul",
              last_name: "McBeth",
              pdga_number: "27523",
              rating: "1050",
              year: q.get("year"),
              division_code: "MPO",
              tournaments: "20",
            },
          ],
        });
      case "/services/json/event":
        return send(200, {
          events: [
            {
              tournament_id: "47877",
              tournament_name: "Las Vegas Challenge",
              tier: "ES",
              event_url: "https://www.pdga.com/tour/event/47877",
              event_phone: "555",
              tournament_director_pdga_number: "10749",
            },
          ],
        });
      case "/services/json/course":
        return send(200, {
          courses: [
            {
              course_id: "2146",
              course_node_nid: "25393",
              course_name: "Bluemont Park",
              holes: "9",
              contact_home_phone: "703-555-0100",
              distance: "",
            },
          ],
        });
      default:
        return send(404, ["not found"]);
    }
  });

  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ state, server, baseUrl: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

async function setup() {
  const mock = await startMockPdga();
  const client = new PdgaClient({ username: "marcus", password: "pw", baseUrl: mock.baseUrl });
  const server = createServer({ client });
  let id = 0;
  const call = (name, args) =>
    server.handle({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
  return { mock, client, server, call };
}

test("initialize and tools/list", async () => {
  const { server, mock } = await setup();
  const init = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
  });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);

  const unknownVersion = await server.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  assert.equal(unknownVersion.result.protocolVersion, "2025-06-18");

  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);

  const list = await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_player_profile",
    "get_player_statistics",
    "search_courses",
    "search_events",
    "search_players",
  ]);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");

  const missing = await server.handle({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(missing.error.code, -32601);
  mock.server.close();
});

test("search_players logs in once, passes params, adds links", async () => {
  const { call, mock } = await setup();
  const r1 = await call("search_players", { last_name: "McBeth", classification: "P", limit: 5 });
  assert.equal(r1.result.isError, undefined);
  const data = r1.result.structuredContent;
  assert.equal(data.players[0].pdga_url, "https://www.pdga.com/player/27523");
  assert.equal(data.players[0].official_status, undefined, "empty fields dropped");
  assert.match(data.attribution, /PDGA/);
  assert.equal(data.has_more, false);

  const q = mock.state.requests.find((r) => r.path === "/services/json/players").query;
  assert.deepEqual(q, { last_name: "McBeth", class: "P", limit: "5", offset: "0" });

  await call("search_players", { pdga_number: "27523" });
  assert.equal(mock.state.logins, 1, "session reused");
  mock.server.close();
});

test("expired session triggers re-login and retry", async () => {
  const { call, mock } = await setup();
  await call("search_players", { last_name: "McBeth" });
  mock.state.expireNext = true;
  const r = await call("search_players", { last_name: "McBeth" });
  assert.equal(r.result.isError, undefined);
  assert.equal(mock.state.logins, 2);
  mock.server.close();
});

test("bad credentials surface a helpful tool error", async () => {
  const mock = await startMockPdga();
  const client = new PdgaClient({ username: "marcus", password: "wrong", baseUrl: mock.baseUrl });
  const server = createServer({ client });
  const r = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_players", arguments: { last_name: "X" } },
  });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /login failed.*HTTP 401/i);
  mock.server.close();
});

test("argument validation", async () => {
  const { call, mock } = await setup();
  let r = await call("search_players", { bogus: 1 });
  assert.match(r.result.content[0].text, /unknown argument 'bogus'/);
  r = await call("search_players", { limit: 500 });
  assert.match(r.result.content[0].text, /<= 200/);
  r = await call("search_events", { start_date: "2025/01/01" });
  assert.match(r.result.content[0].text, /wrong format/);
  r = await call("get_player_profile", {});
  assert.match(r.result.content[0].text, /missing required argument 'pdga_number'/);
  r = await call("nope", {});
  assert.match(r.result.content[0].text, /Unknown tool/);
  assert.equal(mock.state.logins, 0, "no API calls on invalid input");
  mock.server.close();
});

test("events, courses, stats, profile", async () => {
  const { call, mock } = await setup();

  const ev = (await call("search_events", { tier: ["NT", "M"], state: "TX", limit: 1 })).result.structuredContent;
  assert.equal(ev.events[0].pdga_url, "https://www.pdga.com/tour/event/47877");
  assert.equal(ev.events[0].event_phone, undefined);
  assert.equal(ev.events[0].tournament_director_url, "https://www.pdga.com/player/10749");
  assert.equal(ev.has_more, true);
  assert.equal(ev.next_offset, 1);
  const evq = mock.state.requests.find((r) => r.path === "/services/json/event").query;
  assert.equal(evq.tier, "NT,M");

  const co = (await call("search_courses", { latitude: 29.76, longitude: -95.37 })).result.structuredContent;
  assert.equal(co.courses[0].pdga_url, "https://www.pdga.com/node/25393");
  assert.equal(co.courses[0].contact_home_phone, undefined);

  const st = (await call("get_player_statistics", { year: 2025, division_code: "MPO" })).result.structuredContent;
  assert.equal(st.player_statistics[0].year, "2025");

  const pr = (await call("get_player_profile", { pdga_number: "27523", years: [2024, 2025] })).result
    .structuredContent;
  assert.equal(pr.found, true);
  assert.equal(pr.statistics.length, 2);

  const none = (await call("get_player_profile", { pdga_number: "999999" })).result.structuredContent;
  assert.equal(none.found, false);
  mock.server.close();
});

test("end to end over stdio", async () => {
  const mock = await startMockPdga();
  const child = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], {
    env: { ...process.env, PDGA_USERNAME: "marcus", PDGA_PASSWORD: "pw", PDGA_BASE_URL: mock.baseUrl },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const replies = [];
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      replies.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
    }
  });

  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_players", arguments: { pdga_number: "27523" } } });

  const deadline = Date.now() + 5000;
  while (replies.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  mock.server.close();

  assert.equal(replies.length, 3);
  assert.equal(replies[0].result.serverInfo.name, "pdga-mcp");
  assert.equal(replies[1].result.tools.length, 5);
  const text = replies[2].result.content[0].text;
  assert.match(text, /McBeth/);
});

test("missing credentials exits with a clear message", async () => {
  const env = { ...process.env };
  delete env.PDGA_USERNAME;
  delete env.PDGA_PASSWORD;
  const child = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 1);
  assert.match(err, /PDGA_USERNAME/);
});
