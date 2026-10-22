// Tool handlers: turn tool arguments into PDGA API calls and shape the
// results for an LLM. Kept free of MCP SDK code so they're easy to test.

export const ATTRIBUTION = "Player, event, and course data provided by PDGA (https://www.pdga.com/).";
const PDGA = "https://www.pdga.com";

// Drop empty values and fields that only waste tokens.
function compact(obj, omit = []) {
  const out = {};
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (omit.includes(key)) continue;
    if (value === "" || value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function page(items, { limit, offset }) {
  return {
    count: items.length,
    offset,
    limit,
    has_more: items.length === limit,
    next_offset: items.length === limit ? offset + limit : null,
  };
}

function wrap(key, items, paging) {
  return { ...page(items, paging), [key]: items, attribution: ATTRIBUTION };
}

function paging(args) {
  return { limit: args.limit ?? 25, offset: args.offset ?? 0 };
}

function playerUrl(pdgaNumber) {
  return pdgaNumber ? `${PDGA}/player/${pdgaNumber}` : undefined;
}

export function shapePlayer(p) {
  return compact({ ...p, pdga_url: playerUrl(p.pdga_number) });
}

export function shapePlayerStat(p) {
  return compact({ ...p, pdga_url: playerUrl(p.pdga_number) });
}

export function shapeEvent(e) {
  return compact(
    {
      ...e,
      pdga_url: e.event_url || (e.tournament_id ? `${PDGA}/tour/event/${e.tournament_id}` : undefined),
      tournament_director_url: playerUrl(e.tournament_director_pdga_number),
    },
    ["event_url", "event_phone"]
  );
}

export function shapeCourse(c) {
  return compact(
    {
      ...c,
      pdga_url: c.course_node_nid ? `${PDGA}/node/${c.course_node_nid}` : undefined,
    },
    ["contact_home_phone", "legacy_course_courseid", "course_node_nid"]
  );
}

export async function searchPlayers(client, args) {
  const pg = paging(args);
  const body = await client.get("players", {
    pdga_number: args.pdga_number,
    first_name: args.first_name,
    last_name: args.last_name,
    class: args.classification,
    city: args.city,
    state_prov: args.state_prov,
    country: args.country,
    last_modified: args.last_modified,
    ...pg,
  });
  return wrap("players", (body?.players ?? []).map(shapePlayer), pg);
}

export async function getPlayerStatistics(client, args) {
  const pg = paging(args);
  const body = await client.get("player-statistics", {
    year: args.year,
    pdga_number: args.pdga_number,
    division_code: args.division_code,
    class: args.classification,
    gender: args.gender,
    continent: args.continent,
    country: args.country,
    state_prov: args.state_prov,
    last_modified: args.last_modified,
    ...pg,
  });
  return wrap("player_statistics", (body?.players ?? []).map(shapePlayerStat), pg);
}

export async function searchEvents(client, args) {
  const pg = paging(args);
  const body = await client.get("event", {
    tournament_id: args.tournament_id,
    event_name: args.event_name,
    start_date: args.start_date,
    end_date: args.end_date,
    country: args.country,
    state: args.state,
    province: args.province,
    tier: args.tier,
    classification: args.classification,
    ...pg,
  });
  return wrap("events", (body?.events ?? []).map(shapeEvent), pg);
}

export async function searchCourses(client, args) {
  const pg = paging(args);
  const body = await client.get("course", {
    course_id: args.course_id,
    course_name: args.course_name,
    city: args.city,
    state_prov: args.state_prov,
    country: args.country,
    postal_code: args.postal_code,
    latitude: args.latitude,
    longitude: args.longitude,
    ...pg,
  });
  return wrap("courses", (body?.courses ?? []).map(shapeCourse), pg);
}

// Convenience: one call that answers "tell me about player X".
export async function getPlayerProfile(client, args, now = new Date()) {
  const thisYear = now.getFullYear();
  const years = args.years?.length ? args.years : [thisYear, thisYear - 1];

  const profileBody = await client.get("players", { pdga_number: args.pdga_number, limit: 1 });
  const profile = profileBody?.players?.[0];
  if (!profile) {
    return { found: false, pdga_number: args.pdga_number, attribution: ATTRIBUTION };
  }

  const statsByYear = await Promise.all(
    years.map(async (year) => {
      const body = await client.get("player-statistics", {
        pdga_number: args.pdga_number,
        year,
        limit: 50,
      });
      return (body?.players ?? []).map(shapePlayerStat);
    })
  );

  return {
    found: true,
    profile: shapePlayer(profile),
    statistics: statsByYear.flat(),
    years_checked: years,
    attribution: ATTRIBUTION,
  };
}
