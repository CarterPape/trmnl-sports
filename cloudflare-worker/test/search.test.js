import { describe, expect, it } from "vitest";

import { matchRank, searchTeams, searchTier, TIER } from "../lib/search.js";

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

describe("searchTier", () => {
    const divisions = { fbs: new Set(["41"]), fcs: new Set(["2277"]) };
    const tierOf = (code, espnId) => searchTier({ code, espnId }, divisions);

    it("puts every pro league in the top tier", () => {
        expect(tierOf("nba", "4")).toBe(TIER.pro);
        expect(tierOf("nwsl", "41")).toBe(TIER.pro);
    });

    it("ranks an FBS school's rows in every sport as FBS", () => {
        expect(tierOf("cfb", "41")).toBe(TIER.fbs);
        expect(tierOf("wbb", "41")).toBe(TIER.fbs);
    });

    it("treats FCS football and non-FBS basketball as other D-I", () => {
        expect(tierOf("cfb", "2277")).toBe(TIER.otherDivisionI);
        expect(tierOf("mbb", "2250")).toBe(TIER.otherDivisionI);
    });

    it("ties every college when divisions are unavailable", () => {
        expect(searchTier({ code: "cfb", espnId: "2071" }, null)).toBe(
            TIER.otherDivisionI,
        );
        expect(searchTier({ code: "mbb", espnId: "41" }, null)).toBe(
            TIER.otherDivisionI,
        );
        expect(searchTier({ code: "nba", espnId: "4" }, null)).toBe(TIER.pro);
    });

    it("sinks football outside FBS and FCS to the bottom", () => {
        expect(tierOf("cfb", "2071")).toBe(TIER.lowerDivision);
    });
});

describe("searchTeams tiers", () => {
    const team = (code, espnId, name, leagueLabel, tier) => ({
        code,
        espnId,
        name,
        leagueLabel,
        tier,
        searchBlob: name.toLowerCase(),
    });
    const index = [
        team("cfb", "2084", "Buffalo Bulls", "NCAA Football", TIER.fbs),
        team("mbb", "2084", "Buffalo Bulls", "NCAA Men's Basketball", TIER.fbs),
        team("cfb", "58", "South Florida Bulls", "NCAA Football", TIER.fbs),
        team(
            "cfb",
            "2304",
            "Johnson C. Smith Golden Bulls",
            "NCAA Football",
            TIER.lowerDivision,
        ),
        team("nba", "4", "Chicago Bulls", "NBA", TIER.pro),
        team(
            "cfb",
            "2071",
            "Bloomsburg Huskies",
            "NCAA Football",
            TIER.lowerDivision,
        ),
        team(
            "cfb",
            "2277",
            "Houston Christian Huskies",
            "NCAA Football",
            TIER.otherDivisionI,
        ),
        team(
            "cfb",
            "2392",
            "Michigan Tech Huskies",
            "NCAA Football",
            TIER.lowerDivision,
        ),
        team("cfb", "264", "Washington Huskies", "NCAA Football", TIER.fbs),
        team("cfb", "41", "UConn Huskies", "NCAA Football", TIER.fbs),
        team(
            "cfb",
            "2459",
            "Northern Illinois Huskies",
            "NCAA Football",
            TIER.fbs,
        ),
        team("nba", "99", "Bloomington Ballers", "NBA", TIER.pro),
    ];
    const names = (q) => searchTeams(index, q).map((m) => m.name);

    it("puts the pro team ahead of same-mascot colleges", () => {
        expect(names("bulls")).toEqual([
            "Chicago Bulls (NBA)",
            "Buffalo Bulls (NCAA Football)",
            "Buffalo Bulls (NCAA Men's Basketball)",
            "South Florida Bulls (NCAA Football)",
            "Johnson C. Smith Golden Bulls (NCAA Football)",
        ]);
    });

    it("orders FBS, then other D-I, then lower divisions", () => {
        expect(names("huskies")).toEqual([
            "Northern Illinois Huskies (NCAA Football)",
            "UConn Huskies (NCAA Football)",
            "Washington Huskies (NCAA Football)",
            "Houston Christian Huskies (NCAA Football)",
            "Bloomsburg Huskies (NCAA Football)",
            "Michigan Tech Huskies (NCAA Football)",
        ]);
    });

    it("breaks ties within a match rank by tier", () => {
        expect(names("bloom")).toEqual([
            "Bloomington Ballers (NBA)",
            "Bloomsburg Huskies (NCAA Football)",
        ]);
    });

    it("keeps match quality ahead of tier", () => {
        const ranked = searchTeams(
            [
                team("nba", "4", "Chicago Bulls", "NBA", TIER.pro),
                team(
                    "cfb",
                    "3",
                    "Bulls Tech Rams",
                    "NCAA Football",
                    TIER.lowerDivision,
                ),
            ],
            "bulls",
        );
        expect(ranked.map((m) => m.name)).toEqual([
            "Bulls Tech Rams (NCAA Football)",
            "Chicago Bulls (NBA)",
        ]);
    });
});
