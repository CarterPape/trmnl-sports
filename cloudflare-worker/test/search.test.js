import { describe, expect, it } from "vitest";

import { matchRank, searchTeams } from "../lib/search.js";

describe("matchRank", () => {
    const bulls = { name: "Chicago Bulls" };

    it("ranks a team-name prefix highest (0)", () => {
        expect(matchRank(bulls, "chicago")).toBe(0);
    });

    it("ranks a name-token prefix next (1) — the mascot case", () => {
        expect(matchRank(bulls, "bulls")).toBe(1);
    });

    it("ranks a mid-token substring lowest (2)", () => {
        expect(matchRank(bulls, "ull")).toBe(2);
    });
});

describe("searchTeams", () => {
    const index = [
        {
            code: "nba",
            espnId: "4",
            name: "Chicago Bulls",
            leagueLabel: "NBA",
            searchBlob: "chicago bulls | chicago | bulls | bulls | chi",
        },
        {
            code: "nfl",
            espnId: "3",
            name: "Chicago Bears",
            leagueLabel: "NFL",
            searchBlob: "chicago bears | chicago | bears | bears | chi",
        },
        {
            code: "mls",
            espnId: "9",
            name: "Red Star",
            leagueLabel: "MLS",
            searchBlob: "red star | bullseye",
        },
    ];

    it("returns xhrSelectSearch entries carrying an espn team param", () => {
        const [first] = searchTeams(index, "bulls");
        expect(first).toEqual({
            id: "espn|nba|4",
            name: "Chicago Bulls (NBA)",
        });
    });

    it("ranks prefix matches before substring, alphabetical within a tier", () => {
        expect(searchTeams(index, "chicago").map((m) => m.name)).toEqual([
            "Chicago Bears (NFL)",
            "Chicago Bulls (NBA)",
        ]);
    });

    it("ranks a name-token match above an alias-only substring", () => {
        expect(searchTeams(index, "bulls").map((m) => m.name)).toEqual([
            "Chicago Bulls (NBA)",
            "Red Star (MLS)",
        ]);
    });

    it("matches an abbreviation alias", () => {
        expect(searchTeams(index, "chi")).toHaveLength(2);
    });

    it("caps the result count", () => {
        expect(searchTeams(index, "chicago", 1)).toHaveLength(1);
    });

    it("returns nothing when no blob contains the query", () => {
        expect(searchTeams(index, "zzz")).toEqual([]);
    });
});
