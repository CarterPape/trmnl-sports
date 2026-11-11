import { describe, expect, it } from "vitest";

import {
    mergeSchedules,
    nextSeasonUrl,
    parseSchedule,
    parseTeam,
    parseTeamList,
    scheduleUrls,
    teamsUrl,
} from "../lib/espn.js";
import { ESPN_LEAGUES } from "../lib/leagues.js";
import bama from "./fixtures/espn/cfb-bama-regular.json";
import nbaTeams from "./fixtures/espn/nba-teams.json";
import bayern from "./fixtures/espn/soccer-bayern-all.json";
import yankees from "./fixtures/espn/mlb-nyy-regular.json";
import uconnTeam from "./fixtures/espn/wbb-uconn-team.json";
import uconn from "./fixtures/espn/wbb-uconn-schedule.json";

describe("scheduleUrls", () => {
    it("asks a US league for regular season and postseason", () => {
        expect(scheduleUrls(ESPN_LEAGUES.wbb, "41")).toEqual([
            "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams/41/schedule?seasontype=2",
            "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams/41/schedule?seasontype=3",
        ]);
    });

    it("asks soccer for every competition's fixtures", () => {
        expect(scheduleUrls(ESPN_LEAGUES.bundesliga, "132")).toEqual([
            "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/132/schedule?fixture=true",
        ]);
    });
});

describe("nextSeasonUrl", () => {
    it("points a US league at the following season", () => {
        expect(nextSeasonUrl(ESPN_LEAGUES.mlb, "10", yankees)).toBe(
            "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/10/schedule?season=2027&seasontype=2",
        );
    });

    it("is null for soccer and for a response without a season", () => {
        expect(nextSeasonUrl(ESPN_LEAGUES.epl, "359", bayern)).toBeNull();
        expect(nextSeasonUrl(ESPN_LEAGUES.mlb, "10", {})).toBeNull();
    });
});

describe("parseSchedule", () => {
    it("normalizes sides, status, venue, and a UTC start", () => {
        const [first, , , fourth] = parseSchedule(uconn);
        expect(first).toMatchObject({
            id: expect.any(String),
            startUtc: "2026-11-02T22:00:00.000Z",
            timeKnown: true,
            status: "final",
            home: {
                id: "41",
                name: "UConn Huskies",
                badge: "https://a.espncdn.com/i/teamlogos/ncaa/500/41.png",
            },
            away: { id: "172", name: "Cornell Big Red" },
        });
        expect(fourth.status).toBe("scheduled");
        expect(fourth.away.id).toBe("41");
    });

    it("keeps a TBD kickoff's calendar date and marks the time unknown", () => {
        const ironBowl = parseSchedule(bama).at(-1);
        expect(ironBowl.timeKnown).toBe(false);
        expect(ironBowl.date).toBe("2026-11-28");
    });

    it("labels each soccer match with its competition", () => {
        const competitions = parseSchedule(bayern).map((e) => e.competition);
        expect(competitions).toContain("UEFA Champions League");
        expect(competitions).toContain("German Cup");
    });

    it("maps a postponed game to postponed", () => {
        expect(parseSchedule(yankees)[0].status).toBe("postponed");
    });

    it("returns [] for a missing or empty response", () => {
        expect(parseSchedule(undefined)).toEqual([]);
        expect(parseSchedule({ events: [] })).toEqual([]);
    });
});

describe("mergeSchedules", () => {
    it("dedupes by id and sorts by start", () => {
        const events = parseSchedule(uconn);
        const merged = mergeSchedules(events.slice(2), events.slice(0, 3));
        expect(merged.map((e) => e.id)).toEqual(events.map((e) => e.id));
    });
});

describe("parseTeam", () => {
    it("takes the display name and default logo", () => {
        expect(parseTeam(uconnTeam)).toEqual({
            id: "41",
            name: "UConn Huskies",
            badge: "https://a.espncdn.com/i/teamlogos/ncaa/500/41.png",
        });
    });

    it("is null without a team", () => {
        expect(parseTeam({})).toBeNull();
    });
});

describe("teamsUrl", () => {
    it("asks for the whole league in one page", () => {
        expect(teamsUrl(ESPN_LEAGUES.nba)).toBe(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=1000",
        );
    });
});

describe("parseTeamList", () => {
    it("builds one search entry per team, aliases folded into the blob", () => {
        const bulls = parseTeamList(nbaTeams, "nba", "NBA").find(
            (t) => t.espnId === "4",
        );
        expect(bulls).toEqual({
            code: "nba",
            espnId: "4",
            name: "Chicago Bulls",
            leagueLabel: "NBA",
            searchBlob: "chicago bulls | chicago | bulls | bulls | chi",
        });
    });

    it("drops inactive and all-star teams", () => {
        const json = {
            sports: [
                {
                    leagues: [
                        {
                            teams: [
                                { team: { id: "1", displayName: "Kept" } },
                                { team: { id: "2", isActive: false } },
                                { team: { id: "3", isAllStar: true } },
                            ],
                        },
                    ],
                },
            ],
        };
        expect(parseTeamList(json, "nba", "NBA").map((t) => t.espnId)).toEqual(
            ["1"],
        );
    });

    it("is empty for a malformed response", () => {
        expect(parseTeamList({}, "nba", "NBA")).toEqual([]);
    });
});
