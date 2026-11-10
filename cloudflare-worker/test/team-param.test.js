import { describe, expect, it } from "vitest";

import { espnTeamParam, resolveTeamParam } from "../lib/team-param.js";

const LEGACY = { "150726|5789": "wbb|41", "135252|4424": "mlb|2" };
const ROUTED = new Set(["wbb"]);

describe("resolveTeamParam", () => {
    it("reads an espn| param, ignoring TRMNL's ::label suffix", () => {
        expect(
            resolveTeamParam(
                "espn|wbb|41::UConn Huskies (NCAA Women's Basketball)",
                LEGACY,
                ROUTED,
            ),
        ).toEqual({
            provider: "espn",
            idform: "espn",
            code: "wbb",
            espnId: "41",
        });
    });

    it("rejects an espn| param with an unknown league or a non-numeric id", () => {
        expect(resolveTeamParam("espn|xfl|41", LEGACY, ROUTED)).toBeNull();
        expect(resolveTeamParam("espn|wbb|abc", LEGACY, ROUTED)).toBeNull();
    });

    it("translates a mapped legacy id when its league is routed to ESPN", () => {
        expect(
            resolveTeamParam(
                "150726|5789::UConn Women (NCAA Women's Basketball)",
                LEGACY,
                ROUTED,
            ),
        ).toEqual({
            provider: "espn",
            idform: "legacy",
            code: "wbb",
            espnId: "41",
            legacyTeamId: "150726",
        });
    });

    it("keeps a legacy id on TheSportsDB when its league isn't routed yet, or it's unmapped", () => {
        expect(resolveTeamParam("135252|4424", LEGACY, ROUTED)).toEqual({
            provider: "sportsdb",
            idform: "legacy",
            teamId: "135252",
            leagueId: 4424,
        });
        expect(resolveTeamParam("999|4405", LEGACY, ROUTED).provider).toBe(
            "sportsdb",
        );
    });

    it("is null for a missing or junk param", () => {
        expect(resolveTeamParam("", LEGACY, ROUTED)).toBeNull();
        expect(resolveTeamParam("{{ team_id }}", LEGACY, ROUTED)).toBeNull();
    });
});

describe("espnTeamParam", () => {
    it("round-trips through resolveTeamParam", () => {
        expect(
            resolveTeamParam(espnTeamParam("cfb", "333"), LEGACY, ROUTED),
        ).toMatchObject({ code: "cfb", espnId: "333" });
    });
});
