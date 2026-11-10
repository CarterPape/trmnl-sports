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
