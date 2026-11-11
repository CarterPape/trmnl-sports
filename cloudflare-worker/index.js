// Default import (not `import * as`): upng-js is CommonJS, and bundler CJS↔ESM
// interop differs — wrangler's esbuild spreads the named exports onto the
// namespace, but Vite/rollup (the vitest-pool-workers test bundler) exposes
// them only under `.default`. The default import resolves to the module's
// exports object under every bundler, so `UPNG.decode` is defined in both prod
// and tests. (Discovered standing up the 0076 integration suite.)
import UPNG from "upng-js";

import {
    asOfLabel,
    notFoundMessage,
    outageMessage,
    parseLocale,
    parseTimeZone,
    unavailableMessage,
} from "./lib/localization.js";
import { searchTeams, searchTier } from "./lib/search.js";
import { computeBadgeStats, NO_BADGE_TRIM } from "./lib/badge.js";
import { classifyClient, classifySource } from "./lib/client.js";
import {
    divisionStandingsUrl,
    FBS_GROUP,
    FCS_GROUP,
    mergeSchedules,
    nextSeasonUrl,
    parseStandingsTeamIds,
    parseSchedule,
    parseTeam,
    parseTeamList,
    scheduleUrls,
    teamsUrl,
    teamUrl,
} from "./lib/espn.js";
import { ESPN_LEAGUES } from "./lib/leagues.js";
import {
    formatNextGame,
    formatNoGame,
    scheduleTtlSeconds,
    selectNextGame,
    upcomingEvents,
} from "./lib/next-game.js";
import { espnTeamParam, resolveTeamParam } from "./lib/team-param.js";
import LEGACY_TEAM_IDS from "./lib/legacy-team-ids.json";

const TEAMS_CACHE_TTL = 86400; // 24h — per-query search response cache
const TEAM_INDEX_CACHE_TTL = 86400; // 24h — full team list across supported leagues
const NEXT_GAME_CACHE_TTL = 600; // 10 min — under TRMNL's 15-min poll interval
const LKG_CACHE_TTL = 7 * 86400; // durable schedule entry, re-served as last-known-good during an outage

// Cache the per-badge analysis (invert decision + content bounding box) per
// badge URL for a long time — team logos rarely change. Looked up via
// caches.default; recomputed on cache miss.
const BADGE_ANALYSIS_CACHE_TTL = 30 * 86400; // 30 days

const ESPN_TEAM_CACHE_TTL = 30 * 86400;
const ESPN_FAILURE_BACKOFF_TTL = 5 * 60;
const ESPN_COOLDOWN_TTL = 15 * 60;

function jsonResponse(data, { status = 200, cors = false, maxAge = 0 } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (cors) headers["Access-Control-Allow-Origin"] = "*";
    if (maxAge > 0) headers["Cache-Control"] = `public, max-age=${maxAge}`;
    return new Response(JSON.stringify(data), { status, headers });
}

// Build a synthetic GET cache key under the worker's own hostname. This lets
// POST /teams (xhrSelectSearch) and any GET equivalents share the same cache
// entry for the same query, and canonicalizes params so cache hits don't
// depend on incidental URL ordering.
function buildCacheKey(workerHostname, path, params) {
    const search = new URLSearchParams(params).toString();
    return new Request(`https://${workerHostname}/_cache${path}?${search}`, {
        method: "GET",
    });
}

// Analyze a badge for e-ink rendering: { invert, trim } (see computeBadgeStats).
// Cached per badge URL as JSON.
async function analyzeBadge(url, hostname, ctx) {
    if (!url) return { invert: false, trim: NO_BADGE_TRIM };

    const key = buildCacheKey(hostname, "/_badge-analysis", { url });
    const cached = await caches.default.match(key);
    if (cached) {
        try {
            return JSON.parse(await cached.text());
        } catch {
            // Unexpected cache shape (e.g. legacy boolean) — recompute below.
        }
    }

    let result = { invert: false, trim: NO_BADGE_TRIM };
    try {
        const res = await fetch(url);
        if (res.ok) {
            const buf = await res.arrayBuffer();
            const decoded = UPNG.decode(buf);
            const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
            result = computeBadgeStats(rgba, decoded.width, decoded.height);
        }
    } catch {
        // Decode failed (non-PNG, paletted edge case, etc.) — leave neutral.
    }

    const cacheResponse = new Response(JSON.stringify(result), {
        headers: {
            "Cache-Control": `public, max-age=${BADGE_ANALYSIS_CACHE_TTL}`,
        },
    });
    ctx.waitUntil(caches.default.put(key, cacheResponse.clone()));
    return result;
}

// Every supported team, built from one ESPN list call per league and cached per POP, so search is a local substring scan.
async function getTeamIndex(env, hostname, ctx, m) {
    const key = buildCacheKey(hostname, "/_team-index-espn-v3", {});
    const cached = await caches.default.match(key);
    if (cached) return await cached.json();
    m.cache = "rebuild";

    const codes = Object.keys(ESPN_LEAGUES);
    const lists = await Promise.all(
        codes.map((code) =>
            espnFetch(teamsUrl(ESPN_LEAGUES[code]), env, hostname, ctx, m),
        ),
    );
    const missing = lists.filter((json) => !json).length;
    if (missing === codes.length) return [];

    const divisions = await fetchCfbDivisions(env, hostname, ctx, m);
    if (missing > 0 || !divisions) m.upstream = "partial";

    const index = lists.flatMap((json, i) =>
        json ? parseTeamList(json, codes[i], ESPN_LEAGUES[codes[i]].label) : [],
    );
    for (const team of index) {
        team.tier = searchTier(team, divisions);
    }

    ctx.waitUntil(
        caches.default.put(key, cacheEntry(index, TEAM_INDEX_CACHE_TTL)),
    );
    return index;
}

// → { fbs, fcs } id sets, or null when either is unavailable or parses empty.
async function fetchCfbDivisions(env, hostname, ctx, m) {
    const [fbs, fcs] = await Promise.all(
        [FBS_GROUP, FCS_GROUP].map(async (group) =>
            parseStandingsTeamIds(
                await espnFetch(divisionStandingsUrl(group), env, hostname, ctx, m, (res) => res.text()),
            ),
        ),
    );
    if (fbs.size === 0 || fcs.size === 0) return null;
    return { fbs, fcs };
}

// GET /teams?q=SEARCH_TERM, or POST { query } from xhrSelectSearch.
async function handleTeamsSearch(url, request, env, ctx, m) {
    let qRaw = (url.searchParams.get("q") || "").trim();
    if (!qRaw && request.method === "POST") {
        try {
            const body = await request.json();
            qRaw = (body.query || body.q || "").trim();
        } catch {
            // Malformed/absent JSON body → leave qRaw empty, which falls
            // through to the < 2 chars short_query path below.
        }
    }
    if (qRaw.length < 2) {
        m.outcome = "short_query";
        return jsonResponse([], { cors: true });
    }
    const q = qRaw.toLowerCase();

    const key = buildCacheKey(url.hostname, "/teams", { q, v: "espn-tiers-2" });
    const cached = await caches.default.match(key);
    // Stamp BEFORE returning the cached Response — it carries no metadata.
    if (cached) {
        m.cache = "hit";
        return cached;
    }
    m.cache = "miss";

    const index = await getTeamIndex(env, url.hostname, ctx, m);
    const matches = searchTeams(index, q);

    const response = jsonResponse(matches, {
        cors: true,
        maxAge: TEAMS_CACHE_TTL,
    });
    ctx.waitUntil(caches.default.put(key, response.clone()));
    return response;
}

// ── ESPN ──────────────────────────────────────────────────────────────────

function cacheEntry(payload, maxAgeS, fetchedAtMs = Date.now()) {
    return new Response(JSON.stringify(payload), {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${maxAgeS}`,
            "X-Fetched-At": String(fetchedAtMs),
        },
    });
}

// One outbound ESPN call, gated by the per-colo cooldown and our own rate limit. Never throws.
async function espnFetch(url, env, hostname, ctx, m, read = (res) => res.json()) {
    const cooldownKey = buildCacheKey(hostname, "/_espn-cooldown", {});
    if (await caches.default.match(cooldownKey)) {
        m.upstream = "cooldown";
        return null;
    }
    const { success } = (await env.ESPN_LIMITER?.limit({ key: "espn" })) ?? {
        success: true,
    };
    if (!success) {
        m.upstream = "limited";
        return null;
    }

    m.upstreamCalls += 1;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const body = await read(res);
            if (m.upstream === "none") m.upstream = "ok";
            return body;
        }
        if (res.status === 403 || res.status === 429) {
            ctx.waitUntil(
                caches.default.put(
                    cooldownKey,
                    cacheEntry({}, ESPN_COOLDOWN_TTL),
                ),
            );
        }
    } catch {
        // Network failure or a non-JSON body — counted as a failure below.
    }
    m.upstreamFails += 1;
    m.upstream = "fail";
    return null;
}

async function fetchEspnSchedule(league, espnId, env, hostname, ctx, m) {
    const results = await Promise.all(
        scheduleUrls(league, espnId).map((u) =>
            espnFetch(u, env, hostname, ctx, m),
        ),
    );
    if (results.some((r) => r === null)) return null;

    let events = mergeSchedules(...results.map(parseSchedule));
    const next = nextSeasonUrl(league, espnId, results[0]);
    if (next && upcomingEvents(events).length === 0) {
        const nextSeason = await espnFetch(next, env, hostname, ctx, m);
        if (nextSeason)
            events = mergeSchedules(events, parseSchedule(nextSeason));
    }
    m.upstream = "ok";
    return events;
}

// → { events, fetchedAtMs, stale } | null (nothing cached and nothing fetched)
async function getEspnSchedule(ref, env, hostname, ctx, m) {
    const league = ESPN_LEAGUES[ref.code];
    const key = buildCacheKey(hostname, "/_espn-schedule", {
        code: ref.code,
        id: ref.espnId,
    });
    const backoffKey = buildCacheKey(hostname, "/_espn-backoff", {
        code: ref.code,
        id: ref.espnId,
    });

    const cached = await caches.default.match(key);
    let stored = null;
    if (cached) {
        try {
            stored = {
                events: await cached.json(),
                fetchedAtMs: Number(cached.headers.get("X-Fetched-At")) || 0,
            };
        } catch {
            stored = null;
        }
    }
    if (
        stored &&
        Date.now() - stored.fetchedAtMs <
            scheduleTtlSeconds(stored.events) * 1000
    ) {
        m.cache = "hit";
        return { ...stored, stale: false };
    }

    m.cache = "miss";
    const backingOff = await caches.default.match(backoffKey);
    const events = backingOff
        ? null
        : await fetchEspnSchedule(league, ref.espnId, env, hostname, ctx, m);
    if (backingOff) m.upstream = "backoff";

    if (events) {
        ctx.waitUntil(
            caches.default.put(key, cacheEntry(events, LKG_CACHE_TTL)),
        );
        return { events, fetchedAtMs: Date.now(), stale: false };
    }
    if (!backingOff) {
        ctx.waitUntil(
            caches.default.put(
                backoffKey,
                cacheEntry({}, ESPN_FAILURE_BACKOFF_TTL),
            ),
        );
    }
    if (!stored) return null;
    m.cache = "stale";
    return { ...stored, stale: true };
}

async function getEspnTeam(
    ref,
    env,
    hostname,
    ctx,
    m,
    { cacheOnly = false } = {},
) {
    const key = buildCacheKey(hostname, "/_espn-team", {
        code: ref.code,
        id: ref.espnId,
    });
    const cached = await caches.default.match(key);
    if (cached) return await cached.json();
    if (cacheOnly) return null;

    const json = await espnFetch(
        teamUrl(ESPN_LEAGUES[ref.code], ref.espnId),
        env,
        hostname,
        ctx,
        m,
    );
    const team = parseTeam(json);
    if (team) {
        ctx.waitUntil(
            caches.default.put(key, cacheEntry(team, ESPN_TEAM_CACHE_TTL)),
        );
    }
    return team;
}

async function handleEspnNextGame(ref, { type, locale, tz }, url, env, ctx, m) {
    const hostname = url.hostname;
    const leagueLabel = ESPN_LEAGUES[ref.code].label;
    const schedule = await getEspnSchedule(ref, env, hostname, ctx, m);

    if (!schedule) {
        m.outcome = "upstream_fail";
        const team = await getEspnTeam(ref, env, hostname, ctx, m, {
            cacheOnly: true,
        });
        const { invert, trim } = await analyzeBadge(team?.badge, hostname, ctx);
        return jsonResponse({
            ...formatNoGame({
                team,
                invert,
                trim,
                leagueLabel,
                message: outageMessage(locale),
            }),
            outage: true,
        });
    }

    const event = selectNextGame(schedule.events, type, ref.espnId, tz);
    let payload;
    if (event) {
        const [home, away] = await Promise.all([
            analyzeBadge(event.home.badge, hostname, ctx),
            analyzeBadge(event.away.badge, hostname, ctx),
        ]);
        payload = formatNextGame(event, {
            teamId: ref.espnId,
            homeInvert: home.invert,
            awayInvert: away.invert,
            homeTrim: home.trim,
            awayTrim: away.trim,
            locale,
            tz,
            leagueLabel,
        });
    } else {
        const team = await getEspnTeam(ref, env, hostname, ctx, m);
        const { invert, trim } = await analyzeBadge(team?.badge, hostname, ctx);
        const nothingScheduled =
            upcomingEvents(schedule.events, tz).length === 0;
        payload = formatNoGame({
            team,
            invert,
            trim,
            leagueLabel,
            message: nothingScheduled
                ? unavailableMessage(locale)
                : notFoundMessage(locale),
        });
    }

    if (schedule.stale) {
        m.outcome = "stale";
        return jsonResponse({
            ...payload,
            stale: true,
            as_of_label: asOfLabel(schedule.fetchedAtMs, locale, tz),
        });
    }
    return jsonResponse(payload, { maxAge: NEXT_GAME_CACHE_TTL });
}

// GET /next-game?team=espn|CODE|ESPN_ID (or a legacy TEAM_ID|LEAGUE_ID)&type=any|home|away
async function handleNextGame(url, env, ctx, m) {
    const teamParam = url.searchParams.get("team") || "";
    const type = url.searchParams.get("type") || "any";
    const locale = parseLocale(url.searchParams.get("locale"));
    const tz = parseTimeZone(url.searchParams.get("tz"));
    // Local trmnlp sends the literal {{...}} placeholder, so that isn't a real device.
    const deviceRaw = url.searchParams.get("device") || "";
    m.type = type;
    m.tz = tz;
    m.locale = locale;
    m.device = deviceRaw.includes("{{") ? "" : deviceRaw;

    const ref = resolveTeamParam(teamParam, LEGACY_TEAM_IDS);
    if (!ref) {
        m.outcome = "missing_team";
        return jsonResponse({
            found: false,
            not_found_message: notFoundMessage(locale),
        });
    }
    m.provider = "espn";
    m.idform = ref.idform;
    m.team = ref.legacyTeamId || espnTeamParam(ref.code, ref.espnId);
    return handleEspnNextGame(ref, { type, locale, tz }, url, env, ctx, m);
}

// ── Observability ─────────────────────────────────────────────────────────
// One structured log line + one Analytics Engine datapoint per request, both
// built from a single request-scoped collector. The collector is write-only:
// handlers stamp facts as they learn them; only emit() reads it back. The AE
// column order below is a permanent contract — never reorder, append only.
// See cloudflare-worker/observability-queries.md for the schema and queries.
//
//   outcome   ok | stale | short_query | missing_team | upstream_fail
//             | rate_limited | cors_preflight | method_not_allowed | not_found
//             | error  (stale = served last-known-good because upstream failed)
//   cache     none | hit | miss | stale | rebuild  (stale = served a durable
//             entry past its freshness window; rebuild = team-index fan-out ran)
//   upstream  none | ok | fail | partial | limited | cooldown | backoff
//   client    trmnl | trmnlp | curl | browser | other  (UA bucket)
//   source    test | prod  (test = ?test=1, or one of our own dev tools)
function newMetrics(endpoint, method) {
    return {
        endpoint, // "teams" | "next-game" | "other"
        method,
        client: "other", // UA bucket; classified in fetch()
        source: "prod", // test vs prod; classified in fetch()
        outcome: "ok",
        cache: "none",
        upstream: "none",
        upstreamCalls: 0,
        upstreamFails: 0,
        status: 0, // filled from the Response at emit time
        latencyMs: 0,
        // next-game config dimensions (stay "" for other endpoints)
        team: "",
        type: "",
        tz: "",
        locale: "",
        device: "", // trmnl.device.friendly_id; populated only by real TRMNL device polls
        provider: "", // espn (next-game only)
        idform: "", // espn | legacy: which team-param form the install stores
    };
}

function emit(m, env, request) {
    // Workers Logs sink: one structured line, searchable in the dashboard.
    console.log(
        JSON.stringify({
            evt: "req",
            endpoint: m.endpoint,
            method: m.method,
            outcome: m.outcome,
            cache: m.cache,
            upstream: m.upstream,
            upstreamCalls: m.upstreamCalls,
            upstreamFails: m.upstreamFails,
            status: m.status,
            latencyMs: m.latencyMs,
            team: m.team || null,
            type: m.type || null,
            tz: m.tz || null,
            locale: m.locale || null,
            device: m.device || null, // friendly_id; null for non-device traffic
            provider: m.provider || null,
            idform: m.idform || null,
            errorName: m.errorName, // omitted by JSON unless outcome === "error"
            client: m.client,
            source: m.source,
            ua: request.headers.get("user-agent"), // raw, for refining buckets
            colo: request.cf?.colo ?? null,
            ray: request.headers.get("cf-ray"),
        }),
    );

    // Analytics Engine sink: one datapoint, queryable over time. Writes are
    // non-blocking (no await / waitUntil). The binding is absent in local
    // `wrangler dev`, so `?.` makes this a no-op there.
    env.ANALYTICS?.writeDataPoint({
        indexes: [m.endpoint], // sampling key (≤ 96 bytes)
        blobs: [
            m.endpoint, // blob1
            m.outcome, // blob2
            m.cache, // blob3
            m.upstream, // blob4
            m.method, // blob5
            m.team, // blob6
            m.type, // blob7
            m.tz, // blob8
            m.locale, // blob9
            m.client, // blob10
            m.source, // blob11
            m.device, // blob12 (trmnl.device.friendly_id; "" for non-device traffic)
            m.provider, // blob13
            m.idform, // blob14
        ],
        doubles: [
            m.latencyMs, // double1
            m.status, // double2
            m.upstreamCalls, // double3
            m.upstreamFails, // double4
        ],
    });
}

export default {
    async fetch(request, env, ctx) {
        const startedAt = Date.now();
        const url = new URL(request.url);
        const isTeamsSearch = url.pathname === "/teams";
        const endpoint = isTeamsSearch
            ? "teams"
            : url.pathname === "/next-game"
              ? "next-game"
              : "other";
        const m = newMetrics(endpoint, request.method);
        // Bucket the caller's UA (descriptive only) and tag test/prod once, up
        // front, so every path — including OPTIONS, rate-limit, and error —
        // carries it. source is test ONLY when ?test=1 is set; the UA bucket
        // can't separate real TRMNL polls from our own tooling (see lib/client.js).
        // The real-install signal is the `device` dimension on /next-game.
        m.client = classifyClient(request.headers.get("user-agent"));
        m.source = classifySource(url.searchParams.get("test") === "1");

        let response;
        try {
            if (request.method === "OPTIONS") {
                // Only /teams is browser-fetched (xhrSelectSearch); /next-game
                // is server-polled by TRMNL, so it never preflights.
                if (isTeamsSearch) {
                    m.outcome = "cors_preflight";
                    response = new Response(null, {
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods":
                                "GET, POST, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type",
                        },
                    });
                } else {
                    m.outcome = "method_not_allowed";
                    response = new Response(null, { status: 405 });
                }
                return response;
            }

            const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
            const { success } = await env.RATE_LIMITER.limit({ key: ip });
            if (!success) {
                m.outcome = "rate_limited";
                response = jsonResponse(
                    { error: "Too many requests" },
                    { status: 429, cors: isTeamsSearch },
                );
                return response;
            }

            if (isTeamsSearch) {
                response = await handleTeamsSearch(url, request, env, ctx, m);
                return response;
            }
            if (url.pathname === "/next-game") {
                response = await handleNextGame(url, env, ctx, m);
                return response;
            }

            m.outcome = "not_found";
            response = new Response("Not found", { status: 404 });
            return response;
        } catch (err) {
            m.outcome = "error";
            m.errorName = err?.name ?? "Error";
            response = jsonResponse(
                { error: "Internal error" },
                { status: 500, cors: isTeamsSearch },
            );
            return response;
        } finally {
            m.status = response?.status ?? 0;
            m.latencyMs = Date.now() - startedAt;
            try {
                emit(m, env, request);
            } catch {
                // Telemetry must never mask the real response.
            }
        }
    },
};
