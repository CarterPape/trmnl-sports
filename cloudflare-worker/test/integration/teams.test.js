import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../index.js";
import nbaTeams from "../fixtures/espn/nba-teams.json";
import {
    createExecutionContext,
    decodeDatapoint,
    installFetchMock,
    makeEnv,
    waitOnExecutionContext,
} from "./_harness.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const NBA_TEAMS = `${ESPN}/basketball/nba/teams?limit=1000`;
const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/football/college-football/standings";
const CFB_TEAMS = `${ESPN}/football/college-football/teams?limit=1000`;
const division = (group) => `${STANDINGS}?group=${group}`;
const league = (teams) => ({
    sports: [{ leagues: [{ teams }] }],
});
const emptyLeague = league([]);
const roster = (...ids) => ({
    children: [
        { standings: { entries: ids.map((id) => ({ team: { id }, stats: [] })) } },
    ],
});
const INDEX_KEY = "https://worker.test/_cache/_team-index-espn-v2?";

async function search(query, env) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
        new Request("https://worker.test/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
        }),
        env,
        ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: response.status, body: await response.json() };
}

afterEach(async () => {
    vi.unstubAllGlobals();
    await caches.default.delete(INDEX_KEY);
    for (const q of ["bulls", "warriors", "hornets"]) {
        await caches.default.delete(
            `https://worker.test/_cache/teams?q=${q}&v=espn-tiers`,
        );
    }
});

describe("/teams on ESPN", () => {
    it("builds the index from every league and hands out espn| ids", async () => {
        const calls = installFetchMock((url) => {
            if (url === NBA_TEAMS) return json(nbaTeams);
            if (url.startsWith(STANDINGS)) return json(roster("1"));
            return json(emptyLeague);
        });
        const { env, captured } = makeEnv();

        const { status, body } = await search("Bulls", env);

        expect(status).toBe(200);
        expect(body).toEqual([
            { id: "espn|nba|4", name: "Chicago Bulls (NBA)" },
        ]);
        expect(calls).toHaveLength(18);
        expect(calls.filter((u) => u.startsWith(STANDINGS)).sort()).toEqual([
            division(80),
            division(81),
        ]);
        const dp = decodeDatapoint(captured[0]);
        expect(dp.cache).toBe("rebuild");
        expect(dp.upstream).toBe("ok");
        expect(dp.upstreamCalls).toBe(18);
    });

    it("ranks the pro team, then FBS, then FCS, then lower divisions", async () => {
        const cfb = league(
            [
                ["2084", "Buffalo Bulls", "Buffalo", "Bulls"],
                ["2304", "Johnson C. Smith Golden Bulls", "Johnson C. Smith", "Golden Bulls"],
                ["2277", "Houston Bulls", "Houston", "Bulls"],
            ].map(([id, displayName, location, name]) => ({
                team: { id, displayName, location, name },
            })),
        );
        installFetchMock((url) => {
            if (url === NBA_TEAMS) return json(nbaTeams);
            if (url === CFB_TEAMS) return json(cfb);
            if (url === division(80)) return json(roster("2084"));
            if (url === division(81)) return json(roster("2277"));
            return json(emptyLeague);
        });

        const { body } = await search("bulls", makeEnv().env);

        expect(body.map((m) => m.id)).toEqual([
            "espn|nba|4",
            "espn|cfb|2084",
            "espn|cfb|2277",
            "espn|cfb|2304",
        ]);
    });

    it("still answers, pro first, when the division rosters fail", async () => {
        const cfb = league([
            { team: { id: "2084", displayName: "Buffalo Bulls" } },
        ]);
        installFetchMock((url) => {
            if (url === NBA_TEAMS) return json(nbaTeams);
            if (url === CFB_TEAMS) return json(cfb);
            if (url.startsWith(STANDINGS)) return json({}, 500);
            return json(emptyLeague);
        });
        const { env, captured } = makeEnv();

        const { body } = await search("bulls", env);

        expect(body.map((m) => m.id)).toEqual(["espn|nba|4", "espn|cfb|2084"]);
        expect(decodeDatapoint(captured[0]).upstream).toBe("partial");
    });

    it("serves later queries from the cached index without upstream calls", async () => {
        installFetchMock((url) => {
            if (url === NBA_TEAMS) return json(nbaTeams);
            if (url.startsWith(STANDINGS)) return json(roster("1"));
            return json(emptyLeague);
        });
        await search("Bulls", makeEnv().env);

        const calls = installFetchMock(() => undefined);
        const { env, captured } = makeEnv();
        const { body } = await search("warriors", env);

        expect(body).toEqual([
            { id: "espn|nba|9", name: "Golden State Warriors (NBA)" },
        ]);
        expect(calls).toHaveLength(0);
        expect(decodeDatapoint(captured[0]).cache).toBe("miss");
    });

    it("serves a partial index when some leagues fail", async () => {
        installFetchMock((url) =>
            url === NBA_TEAMS ? json(nbaTeams) : json({}, 500),
        );
        const { env, captured } = makeEnv();

        const { body } = await search("hornets", env);

        expect(body).toEqual([
            { id: "espn|nba|30", name: "Charlotte Hornets (NBA)" },
        ]);
        const dp = decodeDatapoint(captured[0]);
        expect(dp.upstream).toBe("partial");
        expect(dp.upstreamFails).toBe(17);
    });

    it("returns nothing and caches no index when every league fails", async () => {
        installFetchMock(() => json({}, 500));
        const { env, captured } = makeEnv();

        const { body } = await search("bulls", env);

        expect(body).toEqual([]);
        expect(decodeDatapoint(captured[0]).upstream).toBe("fail");
        expect(await caches.default.match(INDEX_KEY)).toBeUndefined();
    });

    it("rejects a one-character query without touching upstream", async () => {
        const calls = installFetchMock(() => undefined);
        const { env, captured } = makeEnv();

        const { body } = await search("b", env);

        expect(body).toEqual([]);
        expect(calls).toHaveLength(0);
        expect(decodeDatapoint(captured[0]).outcome).toBe("short_query");
    });
});
