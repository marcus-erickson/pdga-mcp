// MCP tool definitions (name, description, JSON Schema) mapped to handlers.

import {
  searchPlayers,
  getPlayerStatistics,
  getPlayerProfile,
  searchEvents,
  searchCourses,
} from "./handlers.js";

const paging = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 200,
    default: 25,
    description: "Max results to return (1-200). Default 25.",
  },
  offset: {
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Number of results to skip, for paging. Use next_offset from a previous response.",
  },
};

const date = (description) => ({
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: `${description} (YYYY-MM-DD)`,
});

const readOnly = { readOnlyHint: true, openWorldHint: true };

export const TOOLS = [
  {
    name: "search_players",
    title: "Search PDGA players",
    description:
      "Look up PDGA members (current or expired) by PDGA number, name, or location. Returns membership " +
      "status, classification (P=Pro, A=Am), location, and current player rating (rating is only returned " +
      "for current members). Use this to find a player's PDGA number before calling get_player_profile.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        pdga_number: { type: "string", description: "PDGA member number, e.g. '27523'." },
        first_name: { type: "string" },
        last_name: { type: "string" },
        classification: { type: "string", enum: ["P", "A"], description: "P = Pro, A = Amateur." },
        city: { type: "string" },
        state_prov: { type: "string", description: "2-3 character state/province code, e.g. 'TX'." },
        country: { type: "string", description: "Two-letter country code, e.g. 'US'." },
        last_modified: date("Only players modified on or after this date"),
        ...paging,
      },
      additionalProperties: false,
    },
    handler: searchPlayers,
  },
  {
    name: "get_player_profile",
    title: "Get a player's profile and yearly stats",
    description:
      "One-stop summary for a single player: their PDGA profile plus yearly statistics (rating, events " +
      "played, division, points, prize money) for the requested years. Defaults to this year and last year.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        pdga_number: { type: "string", description: "PDGA member number." },
        years: {
          type: "array",
          items: { type: "integer", minimum: 1980, maximum: 2100 },
          maxItems: 10,
          description: "Years to pull statistics for. Default: current and previous year.",
        },
      },
      required: ["pdga_number"],
      additionalProperties: false,
    },
    handler: getPlayerProfile,
  },
  {
    name: "get_player_statistics",
    title: "PDGA player statistics",
    description:
      "Yearly statistics for active members who played at least one PDGA event that year: rating, " +
      "division, tournaments played, rating rounds used, points, and prize money. Filter by year, division " +
      "(e.g. MPO, FPO, MA1, MA40, MJ15), location, gender, or a single PDGA number. Good for leaderboards " +
      "like 'top MA40 players in Texas in 2025'.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "integer", minimum: 1980, maximum: 2100 },
        pdga_number: { type: "string" },
        division_code: { type: "string", description: "3-4 character division code, e.g. MPO, FPO, MA1, MA40." },
        classification: { type: "string", enum: ["P", "A"] },
        gender: { type: "string", enum: ["M", "F"] },
        continent: { type: "string", description: "Two-letter continent code or 3-digit UN M49 code." },
        country: { type: "string", description: "Two-letter country code." },
        state_prov: { type: "string", description: "2-3 character state/province code." },
        last_modified: date("Only records modified on or after this date"),
        ...paging,
      },
      additionalProperties: false,
    },
    handler: getPlayerStatistics,
  },
  {
    name: "search_events",
    title: "Search PDGA events",
    description:
      "Find PDGA-sanctioned events by name, date range, location, tier, or classification. Returns dates, " +
      "location, tier, status, tournament director, and website / registration links. Note: the PDGA API " +
      "does not provide event results or scores.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        tournament_id: { type: "string", description: "PDGA event id, e.g. '47877'." },
        event_name: { type: "string" },
        start_date: date("Events starting on or after"),
        end_date: date("Events ending on or before"),
        country: { type: "string", description: "Two-letter country code." },
        state: { type: "string", description: "Two-letter state code (US)." },
        province: { type: "string", description: "Two-letter province code." },
        tier: {
          type: "array",
          items: { type: "string" },
          description: "Tier codes, e.g. ['M','NT','ES','A','B','C','XA','XB','XC','L'].",
        },
        classification: { type: "string", enum: ["Pro", "Am", "Pro-Am"] },
        ...paging,
      },
      additionalProperties: false,
    },
    handler: searchEvents,
  },
  {
    name: "search_courses",
    title: "Search PDGA course directory",
    description:
      "Search the PDGA course directory by name, city, state, postal code, country, or latitude/longitude. " +
      "Returns hole count, length, basket and tee types, amenities, description, and directions.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "string" },
        course_name: { type: "string" },
        city: { type: "string" },
        state_prov: { type: "string", description: "2-3 character state/province code." },
        country: { type: "string", description: "Two-letter country code." },
        postal_code: { type: "string" },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        ...paging,
      },
      additionalProperties: false,
    },
    handler: searchCourses,
  },
];

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// Minimal JSON Schema check covering what these schemas use. Returns an error string or null.
export function validateArgs(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return "arguments must be an object";
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) return `missing required argument '${key}'`;
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties?.[key];
    if (!prop) {
      if (schema.additionalProperties === false) return `unknown argument '${key}'`;
      continue;
    }
    const err = checkValue(prop, value, key);
    if (err) return err;
  }
  return null;
}

function checkValue(prop, value, path) {
  if (value === undefined || value === null) return null;
  switch (prop.type) {
    case "string":
      if (typeof value !== "string") return `'${path}' must be a string`;
      if (prop.enum && !prop.enum.includes(value)) return `'${path}' must be one of ${prop.enum.join(", ")}`;
      if (prop.pattern && !new RegExp(prop.pattern).test(value)) return `'${path}' has the wrong format`;
      return null;
    case "integer":
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) return `'${path}' must be a number`;
      if (prop.type === "integer" && !Number.isInteger(value)) return `'${path}' must be an integer`;
      if (prop.minimum !== undefined && value < prop.minimum) return `'${path}' must be >= ${prop.minimum}`;
      if (prop.maximum !== undefined && value > prop.maximum) return `'${path}' must be <= ${prop.maximum}`;
      return null;
    case "array":
      if (!Array.isArray(value)) return `'${path}' must be an array`;
      if (prop.maxItems !== undefined && value.length > prop.maxItems)
        return `'${path}' can have at most ${prop.maxItems} items`;
      for (let i = 0; i < value.length; i++) {
        const err = checkValue(prop.items, value[i], `${path}[${i}]`);
        if (err) return err;
      }
      return null;
    default:
      return null;
  }
}
