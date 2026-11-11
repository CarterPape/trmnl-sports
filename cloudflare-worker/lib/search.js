// Ranks the cached team index into TRMNL's xhrSelectSearch shape. `q` arrives pre-lowercased, matching the index's searchBlob.

import { ESPN_LEAGUES } from "./leagues.js";
import { espnTeamParam } from "./team-param.js";

const MAX_SEARCH_RESULTS = 20;

const RANK = { namePrefix: 0, tokenPrefix: 1, substring: 2 };

export const TIER = { pro: 0, fbs: 1, otherDivisionI: 2, lowerDivision: 3 };

export function matchRank(team, q) {
    const name = team.name.toLowerCase();
    if (name.startsWith(q)) return RANK.namePrefix;
    if (name.split(/\s+/).some((token) => token.startsWith(q))) {
        return RANK.tokenPrefix;
    }
    return RANK.substring;
}

// ESPN shares one id per school across sports, so a school's football division ranks its basketball rows too.
export function searchTier(team, { fbs, fcs }) {
    if (!ESPN_LEAGUES[team.code]?.college) return TIER.pro;
    if (fbs.has(team.espnId)) return TIER.fbs;
    if (team.code !== "cfb" || fcs.has(team.espnId)) {
        return TIER.otherDivisionI;
    }
    return TIER.lowerDivision;
}

export function searchTeams(index, q, max = MAX_SEARCH_RESULTS) {
    return index
        .filter((t) => t.searchBlob.includes(q))
        .map((t) => ({ team: t, rank: matchRank(t, q) }))
        .sort(
            (a, b) =>
                a.rank - b.rank ||
                (a.team.tier ?? TIER.otherDivisionI) -
                    (b.team.tier ?? TIER.otherDivisionI) ||
                a.team.name.localeCompare(b.team.name),
        )
        .slice(0, max)
        .map(({ team }) => ({
            id: espnTeamParam(team.code, team.espnId),
            name: `${team.name} (${team.leagueLabel})`,
        }));
}
