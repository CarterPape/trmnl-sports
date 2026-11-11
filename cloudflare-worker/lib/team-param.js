// Resolves the /next-game `team` param, in either form, to the provider that serves it. TRMNL appends `::label` to whatever value was picked.

import { ESPN_LEAGUES } from "./leagues.js";

const ESPN_PREFIX = "espn";

function stripLabel(raw) {
    return (raw || "").split("::")[0].trim();
}

// Legacy `TEAM_ID|LEAGUE_ID[::label]` → { teamId, leagueId: number | null }; parseInt ignores a trailing `::label` where Number() would give NaN.
export function parseTeamParam(teamParam) {
    const [teamId, leagueRaw] = (teamParam || "").split("|");
    const leagueId = leagueRaw ? parseInt(leagueRaw, 10) : NaN;
    return {
        teamId: teamId || "",
        leagueId: Number.isNaN(leagueId) ? null : leagueId,
    };
}

export function espnTeamParam(code, espnId) {
    return `${ESPN_PREFIX}|${code}|${espnId}`;
}

// → { provider: "espn", idform, code, espnId, legacyTeamId? } | { provider: "sportsdb", idform: "legacy", teamId, leagueId } | null
export function resolveTeamParam(teamParam, legacyMap, espnRoutedCodes) {
    const value = stripLabel(teamParam);
    if (!value) return null;

    const [first, code, espnId] = value.split("|");
    if (first === ESPN_PREFIX) {
        if (!ESPN_LEAGUES[code] || !/^\d+$/.test(espnId || "")) return null;
        return { provider: "espn", idform: "espn", code, espnId };
    }

    const { teamId, leagueId } = parseTeamParam(value);
    if (!/^\d+$/.test(teamId)) return null;
    const mapped = legacyMap[`${teamId}|${leagueId}`];
    if (mapped) {
        const [mappedCode, mappedId] = mapped.split("|");
        if (espnRoutedCodes.has(mappedCode)) {
            return {
                provider: "espn",
                idform: "legacy",
                code: mappedCode,
                espnId: mappedId,
                legacyTeamId: teamId,
            };
        }
    }
    return { provider: "sportsdb", idform: "legacy", teamId, leagueId };
}
