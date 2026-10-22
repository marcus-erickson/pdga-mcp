# pdga-mcp

An MCP server that lets Claude query the [PDGA REST API](https://www.pdga.com/dev): players, ratings, yearly player statistics, sanctioned events, and the course directory.

No dependencies. It only needs Node.js 18 or newer.

## Tools

| Tool | What it does |
|---|---|
| `search_players` | Find members by PDGA number, name, class, or location. Returns rating for current members. |
| `get_player_profile` | One player's profile plus yearly stats (defaults to this year and last). |
| `get_player_statistics` | Yearly stats for active players, filterable by year, division (MPO, MA40...), location, gender. |
| `search_events` | Sanctioned events by name, date range, state/country, tier, or class. |
| `search_courses` | Course directory by name, city, state, postal code, or lat/long. |

The PDGA API does not provide event results or round scores, so neither does this server.

## Before you start

1. Have a pdga.com account linked to a **current** PDGA membership.
2. Read and sign the [PDGA API license agreement](https://www.pdga.com/pdga-api-license-agreement). Login fails until you do.
3. Check Node: `node -v` should print v18 or higher.

## Add it to Claude Desktop (Windows)

Open Claude Desktop, go to **Settings > Developer > Edit Config**, and add this to `claude_desktop_config.json` (merge into `mcpServers` if it already exists):

```json
{
  "mcpServers": {
    "pdga": {
      "command": "node",
      "args": ["C:\\devel\\pdga-mcp\\src\\index.js"],
      "env": {
        "PDGA_USERNAME": "your pdga.com username",
        "PDGA_PASSWORD": "your pdga.com password"
      }
    }
  }
}
```

Fully quit and reopen Claude Desktop. You should see the PDGA tools under the tools/connectors menu.

Your password sits in that config file in plain text, so treat the file accordingly and never commit it.

## Try it

- "What's Paul McBeth's current rating and how many events did he play last year?"
- "Find A-tier and B-tier events in Texas between now and March."
- "List 18-hole courses near Houston, 77002."
- "Who were the top 10 MA40 players in Texas in 2025 by points?"

## Development

```
npm test
```

Tests run against a mock PDGA API, so they need no credentials or network.

Layout:

- `src/pdga-client.js` – login, session cookie caching, re-login when the session expires
- `src/handlers.js` – one function per tool, shapes results and adds pdga.com links
- `src/tools.js` – tool names, descriptions, and input schemas
- `src/mcp.js` – minimal MCP protocol over stdio (JSON-RPC)
- `src/index.js` – entry point

## Attribution and license terms

PDGA data is free for **non-commercial** use by current members. Every result includes pdga.com links and the line "Player, event, and course data provided by PDGA," which the license asks you to show wherever the data appears. Contact the PDGA Developer Program before any commercial use or public launch.
