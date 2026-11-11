// Ranks the cached team index into TRMNL's xhrSelectSearch shape. `q` arrives pre-lowercased, matching the index's searchBlob.

import { espnTeamParam } from "./team-param.js";

const MAX_SEARCH_RESULTS = 20;

const RANK = { namePrefix: 0, tokenPrefix: 1, substring: 2 };

export function matchRank(team, q) {
    const name = team.name.toLowerCase();
    if (name.startsWith(q)) return RANK.namePrefix;
    if (name.split(/\s+/).some((token) => token.startsWith(q))) {
        return RANK.tokenPrefix;
    }
    return RANK.substring;
}

export function searchTeams(index, q, max = MAX_SEARCH_RESULTS) {
    return index
        .filter((t) => t.searchBlob.includes(q))
        .map((t) => ({ team: t, rank: matchRank(t, q) }))
        .sort(
            (a, b) => a.rank - b.rank || a.team.name.localeCompare(b.team.name),
        )
        .slice(0, max)
        .map(({ team }) => ({
            id: espnTeamParam(team.code, team.espnId),
            name: `${team.name} (${team.leagueLabel})`,
        }));
}
