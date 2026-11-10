import { describe, expect, it } from "vitest";

import { parseSchedule } from "../lib/espn.js";
import {
    formatNextGame,
    formatNoGame,
    isEventUpcoming,
    scheduleTtlSeconds,
    selectNextGame,
} from "../lib/next-game.js";
import bama from "./fixtures/espn/cfb-bama-regular.json";
import uconn from "./fixtures/espn/wbb-uconn-schedule.json";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T12:00:00Z");
const events = parseSchedule(uconn);

function event(overrides) {
    return {
        id: "1",
        startUtc: new Date(NOW + HOUR).toISOString(),
        timeKnown: true,
        date: "2026-11-10",
        status: "scheduled",
        competition: "",
        venue: "",
        home: { id: "41", name: "Home", badge: null },
        away: { id: "2", name: "Away", badge: null },
        ...overrides,
    };
}

describe("isEventUpcoming", () => {
    it("keeps a game until four hours past its start", () => {
        const start = (ms) => event({ startUtc: new Date(ms).toISOString() });
        expect(isEventUpcoming(start(NOW - 3 * HOUR), "UTC", NOW)).toBe(true);
        expect(isEventUpcoming(start(NOW - 5 * HOUR), "UTC", NOW)).toBe(false);
    });

    it("drops final, postponed, and canceled games regardless of time", () => {
        for (const status of ["final", "postponed", "canceled"]) {
            expect(isEventUpcoming(event({ status }), "UTC", NOW)).toBe(false);
        }
    });

    it("judges a TBD game by calendar day in the user's zone", () => {
        const tbd = event({ timeKnown: false, date: "2026-11-09" });
        expect(isEventUpcoming(tbd, "UTC", NOW)).toBe(false);
        const lateNightPacific = Date.parse("2026-11-10T06:00:00Z");
        expect(
            isEventUpcoming(tbd, "America/Los_Angeles", lateNightPacific),
        ).toBe(true);
    });
});

describe("selectNextGame", () => {
    it("picks the soonest upcoming game", () => {
        expect(selectNextGame(events, "any", "41", "UTC", NOW).startUtc).toBe(
            "2026-11-12T23:30:00.000Z",
        );
    });

    it("applies the home/away filter against the ESPN team id", () => {
        expect(selectNextGame(events, "home", "41", "UTC", NOW)).toBeNull();
        expect(selectNextGame(events, "away", "41", "UTC", NOW).home.id).toBe(
            "194",
        );
    });
});

describe("scheduleTtlSeconds", () => {
    it("is 2h with a game inside 48h, 12h beyond, 24h with none", () => {
        expect(scheduleTtlSeconds([event({})], NOW)).toBe(2 * 3600);
        const far = event({
            startUtc: new Date(NOW + 72 * HOUR).toISOString(),
        });
        expect(scheduleTtlSeconds([far], NOW)).toBe(12 * 3600);
        expect(scheduleTtlSeconds([event({ status: "final" })], NOW)).toBe(
            24 * 3600,
        );
        expect(scheduleTtlSeconds([], NOW)).toBe(24 * 3600);
    });
});

describe("formatNextGame", () => {
    const stats = {
        homeInvert: false,
        awayInvert: true,
        homeTrim: { x: 0, y: 0, w: 1, h: 1 },
        awayTrim: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    };

    it("builds the template payload, naming the configured side", () => {
        const game = selectNextGame(events, "any", "41", "UTC", NOW);
        const payload = formatNextGame(game, {
            ...stats,
            teamId: "41",
            locale: "en-US",
            tz: "America/New_York",
            leagueLabel: "NCAA Women's Basketball",
            nowMs: NOW,
        });
        expect(payload).toMatchObject({
            found: true,
            home_team: "Ohio State Buckeyes",
            away_team: "UConn Huskies",
            away_team_badge_invert: true,
            start_utc_timestamp: "2026-11-12T23:30:00.000Z",
            date_label: "Thursday, Nov 12",
            time_label: expect.stringMatching(/^6:30\sp\.m\.$/),
            team_name: "UConn Huskies",
            team_league_label: "NCAA Women's Basketball",
        });
    });

    it("shows a TBD game's day with no time", () => {
        const ironBowl = parseSchedule(bama).at(-1);
        const payload = formatNextGame(ironBowl, {
            ...stats,
            teamId: "333",
            locale: "en-US",
            tz: "America/Los_Angeles",
            leagueLabel: "NCAA Football",
            nowMs: NOW,
        });
        expect(payload.date_label).toBe("Saturday, Nov 28");
        expect(payload.time_label).toBe("");
    });
});

describe("formatNoGame", () => {
    it("carries the team's badge and the message", () => {
        expect(
            formatNoGame({
                team: { id: "41", name: "UConn Huskies", badge: "b.png" },
                invert: false,
                trim: { x: 0, y: 0, w: 1, h: 1 },
                leagueLabel: "NCAA Women's Basketball",
                message: "Schedule not out yet",
            }),
        ).toEqual({
            found: false,
            team_badge: "b.png",
            team_badge_invert: false,
            team_badge_trim: { x: 0, y: 0, w: 1, h: 1 },
            team_name: "UConn Huskies",
            team_league_label: "NCAA Women's Basketball",
            not_found_message: "Schedule not out yet",
        });
    });
});
