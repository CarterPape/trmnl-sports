// Pure translation between ESPN's site API and our own shapes. No I/O: the handler fetches the URLs built here and hands the parsed JSON back.

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// ESPN defaults to the current season *type*, so a US league needs regular + postseason asked for explicitly. Soccer's `all` path spans every competition.
export function scheduleUrls(league, espnTeamId) {
    if (league.soccer) {
        return [
            `${ESPN_BASE}/soccer/all/teams/${espnTeamId}/schedule?fixture=true`,
        ];
    }
    const base = `${ESPN_BASE}/${league.path}/teams/${espnTeamId}/schedule`;
    return [`${base}?seasontype=2`, `${base}?seasontype=3`];
}

export function nextSeasonUrl(league, espnTeamId, scheduleJson) {
    const year = scheduleJson?.requestedSeason?.year;
    if (league.soccer || !year) return null;
    return `${ESPN_BASE}/${league.path}/teams/${espnTeamId}/schedule?season=${year + 1}&seasontype=2`;
}

export function teamUrl(league, espnTeamId) {
    return `${ESPN_BASE}/${league.path}/teams/${espnTeamId}`;
}

export function teamsUrl(league) {
    return `${ESPN_BASE}/${league.path}/teams?limit=1000`;
}

export const FBS_GROUP = 80;
export const FCS_GROUP = 81;

// The site API's team lists carry no division, so CFB's FBS/FCS membership comes from the division standings.
export function divisionStandingsUrl(group) {
    return `https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=${group}`;
}

// Scans the raw text instead of parsing it: a standings body is ~2.5 MB of per-team stats, and only the ids matter.
export function parseStandingsTeamIds(standingsText) {
    const ids = String(standingsText ?? "").matchAll(/"team":\{"id":"(\d+)"/g);
    return new Set([...ids].map(([, id]) => id));
}

// → team-search index entries for one league; searchBlob is lowercased so `searchTeams` can substring-match it directly.
export function parseTeamList(teamsJson, code, leagueLabel) {
    const teams = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
    return teams
        .map(({ team }) => team)
        .filter(
            (team) => team?.id && team.isActive !== false && !team.isAllStar,
        )
        .map((team) => {
            const name = team.displayName || "";
            const aliases = [
                name,
                team.location,
                team.name,
                team.shortDisplayName,
                team.abbreviation,
            ];
            return {
                code,
                espnId: String(team.id),
                name,
                leagueLabel,
                searchBlob: aliases.filter(Boolean).join(" | ").toLowerCase(),
            };
        });
}

function defaultLogo(logos) {
    if (!Array.isArray(logos) || logos.length === 0) return null;
    const preferred = logos.find((l) => l.rel?.includes("default"));
    return (preferred || logos[0]).href || null;
}

function eventStatus(statusType) {
    const name = statusType?.name || "";
    if (name.includes("POSTPONED")) return "postponed";
    if (name.includes("CANCEL")) return "canceled";
    if (statusType?.state === "in") return "live";
    if (statusType?.state === "post") return "final";
    return "scheduled";
}

function side(competitor) {
    const team = competitor?.team || {};
    return {
        id: String(team.id ?? competitor?.id ?? ""),
        name: team.displayName || "",
        badge: defaultLogo(team.logos) || team.logo || null,
    };
}

function parseEvent(raw) {
    const competition = raw.competitions?.[0];
    const competitors = competition?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const startMs = Date.parse(raw.date);
    if (!home || !away || isNaN(startMs)) return null;
    const startUtc = new Date(startMs).toISOString();
    return {
        id: String(raw.id),
        startUtc,
        timeKnown: raw.timeValid !== false,
        date: startUtc.slice(0, 10),
        status: eventStatus(competition.status?.type),
        competition: raw.league?.name || raw.seasonType?.name || "",
        venue: competition.venue?.fullName || "",
        home: side(home),
        away: side(away),
    };
}

export function parseSchedule(scheduleJson) {
    return (scheduleJson?.events || []).map(parseEvent).filter(Boolean);
}

export function mergeSchedules(...eventLists) {
    const byId = new Map();
    for (const list of eventLists) {
        for (const event of list) byId.set(event.id, event);
    }
    return [...byId.values()].sort((a, b) =>
        a.startUtc.localeCompare(b.startUtc),
    );
}

export function parseTeam(teamJson) {
    const team = teamJson?.team;
    if (!team?.id) return null;
    return {
        id: String(team.id),
        name: team.displayName || "",
        badge: defaultLogo(team.logos),
    };
}
