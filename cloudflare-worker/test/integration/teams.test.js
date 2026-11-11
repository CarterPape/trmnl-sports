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
const emptyLeague = { sports: [{ leagues: [{ teams: [] }] }] };
const INDEX_KEY = "https://worker.test/_cache/_team-index-espn?";

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
            `https://worker.test/_cache/teams?q=${q}&v=espn`,
        );
    }
});

describe("/teams on ESPN", () => {
    it("builds the index from every league and hands out espn| ids", async () => {
        const calls = installFetchMock((url) =>
            url === NBA_TEAMS ? json(nbaTeams) : json(emptyLeague),
        );
        const { env, captured } = makeEnv();

        const { status, body } = await search("Bulls", env);

        expect(status).toBe(200);
        expect(body).toEqual([
            { id: "espn|nba|4", name: "Chicago Bulls (NBA)" },
        ]);
        expect(calls).toHaveLength(16);
        expect(calls.every((u) => u.startsWith(ESPN))).toBe(true);
        const dp = decodeDatapoint(captured[0]);
        expect(dp.cache).toBe("rebuild");
        expect(dp.upstream).toBe("ok");
        expect(dp.upstreamCalls).toBe(16);
    });

    it("serves later queries from the cached index without upstream calls", async () => {
        installFetchMock((url) =>
            url === NBA_TEAMS ? json(nbaTeams) : json(emptyLeague),
        );
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
        expect(dp.upstreamFails).toBe(15);
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
