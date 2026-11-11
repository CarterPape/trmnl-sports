// The load-bearing skeleton test (pape-docs/0076, watch-out #2): drive the REAL
// UPNG.decode → computeBadgeStats path through the /next-game fetch boundary,
// confirming upng-js bundles and runs inside workerd under the Workers pool.
// A mocked schedule yields one future event; mocked badge PNGs (opaque white
// vs. opaque black) must come back through the handler as invert true vs.
// false — proving the decode actually ran and distinguished them.

import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../index.js";
import {
    createExecutionContext,
    decodeDatapoint,
    installFetchMock,
    makeBadgePng,
    makeEnv,
    waitOnExecutionContext,
} from "./_harness.js";

// NBA team 9101 vs 9102: ids distinct from other test files, so the shared caches.default never collides.
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const TEAM_ID = "9101";
const HOME_BADGE = "https://badges.test/home.png";
const AWAY_BADGE = "https://badges.test/away.png";

const competitor = (homeAway, id, badge) => ({
    homeAway,
    id,
    team: {
        id,
        displayName: `Team ${id}`,
        logos: [{ href: badge, rel: ["full", "default"] }],
    },
});

const SCHEDULE = {
    requestedSeason: { year: 2099, type: 2 },
    events: [
        {
            id: "1",
            date: "2099-06-01T19:00Z",
            timeValid: true,
            competitions: [
                {
                    status: {
                        type: { name: "STATUS_SCHEDULED", state: "pre" },
                    },
                    venue: { fullName: "Test Arena" },
                    competitors: [
                        competitor("home", TEAM_ID, HOME_BADGE),
                        competitor("away", "9102", AWAY_BADGE),
                    ],
                },
            ],
        },
    ],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("/next-game badge analysis", () => {
    it("decodes badge PNGs via upng and threads invert/trim into the payload", async () => {
        installFetchMock((url) => {
            if (url === `${ESPN}/teams/${TEAM_ID}/schedule?seasontype=2`)
                return Response.json(SCHEDULE);
            if (url === `${ESPN}/teams/${TEAM_ID}/schedule?seasontype=3`)
                return Response.json({ events: [] });
            if (url === HOME_BADGE) return new Response(makeBadgePng()); // opaque white
            if (url === AWAY_BADGE) {
                return new Response(makeBadgePng({ r: 0, g: 0, b: 0 })); // opaque black
            }
            return undefined; // → fail loudly
        });

        const { env, captured } = makeEnv();
        const ctx = createExecutionContext();

        const response = await worker.fetch(
            new Request(
                `https://worker.test/next-game?team=espn|nba|${TEAM_ID}&type=any&locale=en-US&tz=UTC`,
            ),
            env,
            ctx,
        );
        await waitOnExecutionContext(ctx);

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body.found).toBe(true);
        expect(body.team_name).toBe("Team 9101");
        expect(body.team_league_label).toBe("NBA");

        // The real decode ran and distinguished the two badges: white → invert,
        // black → not. Trim is the opaque-content box; a solid badge fills the
        // canvas, so the no-trim sentinel {0,0,1,1}.
        expect(body.home_team_badge_invert).toBe(true);
        expect(body.away_team_badge_invert).toBe(false);
        expect(body.home_team_badge_trim).toEqual({ x: 0, y: 0, w: 1, h: 1 });

        // Pre-localized labels were produced server-side.
        expect(body.start_utc_timestamp).toBe("2099-06-01T19:00:00.000Z");
        expect(body.date_label).toBeTruthy();
        expect(body.time_label).toBeTruthy();

        // One datapoint, wired for the happy path.
        expect(captured).toHaveLength(1);
        const dp = decodeDatapoint(captured[0]);
        expect(dp.endpoint).toBe("next-game");
        expect(dp.outcome).toBe("ok");
        expect(dp.cache).toBe("miss");
        expect(dp.upstream).toBe("ok");
        expect(dp.upstreamCalls).toBe(2);
        expect(dp.team).toBe(`espn|nba|${TEAM_ID}`);
    });
});
