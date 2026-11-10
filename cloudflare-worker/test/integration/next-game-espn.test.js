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

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const WBB = `${ESPN}/basketball/womens-college-basketball`;
const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

function espnEvent({ id, date, homeId, awayId, timeValid = true }) {
    const competitor = (homeAway, teamId) => ({
        homeAway,
        id: teamId,
        team: {
            id: teamId,
            displayName: `Team ${teamId}`,
            logos: [
                {
                    href: `https://logos.test/${teamId}.png`,
                    rel: ["full", "default"],
                },
            ],
        },
    });
    return {
        id,
        date,
        timeValid,
        competitions: [
            {
                status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
                venue: { fullName: "Test Arena" },
                competitors: [
                    competitor("home", homeId),
                    competitor("away", awayId),
                ],
            },
        ],
    };
}

const schedule = (events, year = 2099) => ({
    requestedSeason: { year, type: 2 },
    events,
});

function espnRoutes(routes) {
    return installFetchMock((url) => {
        if (url.startsWith("https://logos.test/"))
            return new Response(makeBadgePng());
        return routes(url);
    });
}

async function poll(team, env, extra = "") {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
        new Request(
            `https://worker.test/next-game?team=${encodeURIComponent(team)}&type=any&locale=en-US&tz=UTC${extra}`,
        ),
        env,
        ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: response.status, body: await response.json() };
}

async function seedSchedule(code, id, events, fetchedAtMs) {
    await caches.default.put(
        new Request(
            `https://worker.test/_cache/_espn-schedule?code=${code}&id=${id}`,
        ),
        new Response(JSON.stringify(events), {
            headers: {
                "Cache-Control": "public, max-age=604800",
                "X-Fetched-At": String(fetchedAtMs),
            },
        }),
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("/next-game on ESPN", () => {
    it("serves a legacy-id install from ESPN, then shares the cache with the espn| form", async () => {
        const calls = espnRoutes((url) => {
            if (url === `${WBB}/teams/41/schedule?seasontype=2`) {
                return json(
                    schedule([
                        espnEvent({
                            id: "1",
                            date: "2099-01-03T00:00Z",
                            homeId: "41",
                            awayId: "172",
                        }),
                        espnEvent({
                            id: "2",
                            date: "2099-01-01T00:00Z",
                            homeId: "194",
                            awayId: "41",
                        }),
                    ]),
                );
            }
            if (url === `${WBB}/teams/41/schedule?seasontype=3`)
                return json({ events: [] });
            return undefined;
        });
        const { env, captured } = makeEnv();

        const first = await poll(
            "150726|5789::UConn Women (NCAA Women's Basketball)",
            env,
        );
        expect(first.body).toMatchObject({
            found: true,
            home_team: "Team 194",
            away_team: "Team 41",
            team_name: "Team 41",
            team_league_label: "NCAA Women's Basketball",
            venue: "Test Arena",
        });
        expect(decodeDatapoint(captured[0])).toMatchObject({
            provider: "espn",
            idform: "legacy",
            team: "150726",
            cache: "miss",
            upstream: "ok",
            upstreamCalls: 2,
        });

        const callsBefore = calls.length;
        const second = await poll("espn|wbb|41", env);
        expect(second.body).toEqual(first.body);
        expect(calls.length).toBe(callsBefore);
        expect(decodeDatapoint(captured[1])).toMatchObject({
            idform: "espn",
            cache: "hit",
            upstreamCalls: 0,
        });
    });

    it("says the schedule isn't out yet when neither this season nor next has a game", async () => {
        const calls = espnRoutes((url) => {
            if (url.startsWith(`${WBB}/teams/501/schedule?seasontype=`))
                return json(schedule([], 2001));
            if (url === `${WBB}/teams/501/schedule?season=2002&seasontype=2`)
                return json({ events: [] });
            if (url === `${WBB}/teams/501`) {
                return json({
                    team: {
                        id: "501",
                        displayName: "Off Season U",
                        logos: [
                            {
                                href: "https://logos.test/501.png",
                                rel: ["default"],
                            },
                        ],
                    },
                });
            }
            return undefined;
        });
        const { env } = makeEnv();

        const { body } = await poll("espn|wbb|501", env);
        expect(body).toMatchObject({
            found: false,
            team_name: "Off Season U",
            team_badge: "https://logos.test/501.png",
            not_found_message: "Schedule not out yet",
        });
        expect(calls).toContain(
            `${WBB}/teams/501/schedule?season=2002&seasontype=2`,
        );
    });

    it("finds next season's opener when this season is over", async () => {
        espnRoutes((url) => {
            if (url.startsWith(`${WBB}/teams/502/schedule?seasontype=`))
                return json(schedule([], 2098));
            if (url === `${WBB}/teams/502/schedule?season=2099&seasontype=2`) {
                return json(
                    schedule([
                        espnEvent({
                            id: "9",
                            date: "2099-11-02T00:00Z",
                            homeId: "502",
                            awayId: "7",
                        }),
                    ]),
                );
            }
            return undefined;
        });
        const { env } = makeEnv();

        const { body } = await poll("espn|wbb|502", env);
        expect(body.found).toBe(true);
        expect(body.home_team).toBe("Team 502");
    });

    it("reports an outage with no cache, then backs off instead of retrying every poll", async () => {
        const calls = espnRoutes((url) => {
            if (url.includes("/teams/503")) return json({}, 500);
            return undefined;
        });
        const { env, captured } = makeEnv();

        const { body } = await poll("espn|wbb|503", env);
        expect(body).toMatchObject({
            found: false,
            outage: true,
            not_found_message: "Schedule unavailable",
        });
        expect(decodeDatapoint(captured[0]).outcome).toBe("upstream_fail");

        const callsBefore = calls.length;
        await poll("espn|wbb|503", env);
        expect(calls.length).toBe(callsBefore);
        expect(decodeDatapoint(captured[1]).upstream).toBe("backoff");
    });

    it("re-serves a stale schedule, marked, when ESPN fails", async () => {
        espnRoutes((url) =>
            url.includes("/teams/504/schedule") ? json({}, 502) : undefined,
        );
        await seedSchedule(
            "wbb",
            "504",
            [
                {
                    id: "5",
                    startUtc: "2099-02-01T00:00:00.000Z",
                    timeKnown: true,
                    date: "2099-02-01",
                    status: "scheduled",
                    competition: "",
                    venue: "",
                    home: { id: "504", name: "Stale Home", badge: null },
                    away: { id: "8", name: "Stale Away", badge: null },
                },
            ],
            Date.now() - 13 * 3600 * 1000,
        );
        const { env, captured } = makeEnv();

        const { body } = await poll("espn|wbb|504", env);
        expect(body).toMatchObject({
            found: true,
            home_team: "Stale Home",
            stale: true,
        });
        expect(body.as_of_label).toMatch(/^as of /);
        expect(decodeDatapoint(captured[0])).toMatchObject({
            outcome: "stale",
            cache: "stale",
        });
    });

    it("makes no ESPN call when our own limiter says no", async () => {
        const calls = espnRoutes(() => undefined);
        const { env, captured } = makeEnv({ espnLimit: false });

        const { body } = await poll("espn|wbb|505", env);
        expect(body.outage).toBe(true);
        expect(calls).toEqual([]);
        expect(decodeDatapoint(captured[0]).upstream).toBe("limited");
    });

    it("cools off every team after a 403", async () => {
        const calls = espnRoutes((url) =>
            url.includes("/teams/506/") ? json({}, 403) : undefined,
        );
        const { env, captured } = makeEnv();

        await poll("espn|wbb|506", env);
        const callsBefore = calls.length;
        await poll("espn|cfb|507", env);
        expect(calls.length).toBe(callsBefore);
        expect(decodeDatapoint(captured[1]).upstream).toBe("cooldown");
    });

    it("leaves a legacy id from a league ESPN doesn't carry on TheSportsDB", async () => {
        espnRoutes((url) => {
            if (url.includes("thesportsdb.com"))
                return json({ schedule: [], lookup: [] });
            return undefined;
        });
        const { env, captured } = makeEnv();

        await poll("135253|4405", env);
        expect(decodeDatapoint(captured[0])).toMatchObject({
            provider: "sportsdb",
            idform: "legacy",
        });
    });
});
