// Resolves the /next-game `team` param, in either form, to the provider that serves it. TRMNL appends `::label` to whatever value was picked.

import { ESPN_LEAGUES } from "./leagues.js";
import { parseTeamParam } from "./search.js";

const ESPN_PREFIX = "espn";

function stripLabel(raw) {
    return (raw || "").split("::")[0].trim();
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
