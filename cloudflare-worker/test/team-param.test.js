import { describe, expect, it } from "vitest";

import {
    espnTeamParam,
    parseTeamParam,
    resolveTeamParam,
} from "../lib/team-param.js";

const LEGACY = { "150726|5789": "wbb|41", "135252|4424": "mlb|2" };

describe("resolveTeamParam", () => {
    it("reads an espn| param, ignoring TRMNL's ::label suffix", () => {
        expect(
            resolveTeamParam(
                "espn|wbb|41::UConn Huskies (NCAA Women's Basketball)",
                LEGACY,
            ),
        ).toEqual({
            idform: "espn",
            code: "wbb",
            espnId: "41",
        });
    });

    it("rejects an espn| param with an unknown league or a non-numeric id", () => {
        expect(resolveTeamParam("espn|xfl|41", LEGACY)).toBeNull();
        expect(resolveTeamParam("espn|wbb|abc", LEGACY)).toBeNull();
    });

    it("translates a mapped legacy id to its ESPN team", () => {
        expect(
            resolveTeamParam(
                "150726|5789::UConn Women (NCAA Women's Basketball)",
                LEGACY,
            ),
        ).toEqual({
            idform: "legacy",
            code: "wbb",
            espnId: "41",
            legacyTeamId: "150726",
        });
    });

    it("is null for a legacy id the frozen map doesn't carry", () => {
        expect(resolveTeamParam("999|4405", LEGACY)).toBeNull();
        expect(resolveTeamParam("135252|4380", LEGACY)).toBeNull();
    });

    it("is null for a missing or junk param", () => {
        expect(resolveTeamParam("", LEGACY)).toBeNull();
        expect(resolveTeamParam("{{ team_id }}", LEGACY)).toBeNull();
    });
});

describe("espnTeamParam", () => {
    it("round-trips through resolveTeamParam", () => {
        expect(
            resolveTeamParam(espnTeamParam("cfb", "333"), LEGACY),
        ).toMatchObject({ code: "cfb", espnId: "333" });
    });
});

describe("parseTeamParam", () => {
    it("parses a real-install param carrying TRMNL's ::label suffix", () => {
        expect(parseTeamParam("135252|4424::Boston Red Sox (MLB)")).toEqual({
            teamId: "135252",
            leagueId: 4424,
        });
    });

    it("parses the clean ID|LEAGUE shape", () => {
        expect(parseTeamParam("135252|4424")).toEqual({
            teamId: "135252",
            leagueId: 4424,
        });
    });

    it("yields a null leagueId when the league half is absent", () => {
        expect(parseTeamParam("135252")).toEqual({
            teamId: "135252",
            leagueId: null,
        });
    });

    it("yields an empty teamId and null leagueId for an empty param", () => {
        expect(parseTeamParam("")).toEqual({ teamId: "", leagueId: null });
    });

    it("yields a null leagueId (not NaN) when the league half isn't numeric", () => {
        expect(parseTeamParam("135252|nonsense")).toEqual({
            teamId: "135252",
            leagueId: null,
        });
    });
});
