#!/usr/bin/env node
// Builds lib/legacy-team-ids.json: legacy "<sportsDbTeamId>|<sportsDbLeagueId>" → "<code>|<espnTeamId>".
// Usage: node scripts/build-legacy-team-map.mjs [--check <id> ...]   (reads SPORTSDB_API_KEY from env or .dev.vars)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESPN_BASE } from "../lib/espn.js";
import { ESPN_LEAGUES } from "../lib/leagues.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "lib/legacy-team-ids.json");
const OVERRIDES = join(root, "scripts/legacy-team-map-overrides.json");
const DROPPED_TOKENS = new Set([
    "fc",
    "cf",
    "afc",
    "sc",
    "the",
    "women",
    "womens",
    "football",
    "club",
]);

function apiKey() {
    if (process.env.SPORTSDB_API_KEY) return process.env.SPORTSDB_API_KEY;
    const line = readFileSync(join(root, ".dev.vars"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("SPORTSDB_API_KEY"));
    return line.split("=").slice(1).join("=").replace(/^"|"$/g, "").trim();
}

export function normalizeName(name) {
    return (name || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[.'’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((t) => t && !DROPPED_TOKENS.has(t))
        .map((t) => (t === "saint" ? "st" : t))
        .join(" ");
}

async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

async function espnTeams(league) {
    const json = await getJson(`${ESPN_BASE}/${league.path}/teams?limit=1000`);
    return json.sports[0].leagues[0].teams.map(({ team }) => team);
}

function espnKeys(team) {
    return [
        team.displayName,
        team.location,
        team.shortDisplayName,
        `${team.location} ${team.name}`,
    ];
}

function sportsDbKeys(team) {
    return [
        team.strTeam,
        team.strTeamAlternate,
        ...(team.strTeamAlternate || "").split(","),
    ];
}

function indexByKey(teams, keysOf) {
    const index = new Map();
    for (const team of teams) {
        for (const key of new Set(
            keysOf(team).map(normalizeName).filter(Boolean),
        )) {
            if (!index.has(key)) index.set(key, new Set());
            index.get(key).add(String(team.id));
        }
    }
    return index;
}

function match(sportsDbTeam, index) {
    const candidates = new Set();
    for (const key of sportsDbKeys(sportsDbTeam)
        .map(normalizeName)
        .filter(Boolean)) {
        const ids = index.get(key);
        if (ids?.size === 1) candidates.add([...ids][0]);
    }
    return candidates.size === 1 ? [...candidates][0] : null;
}

async function main() {
    const checkIds = process.argv.includes("--check")
        ? process.argv.slice(process.argv.indexOf("--check") + 1)
        : [];
    const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8"));
    const headers = { "X-API-KEY": apiKey() };
    const map = {};
    const misses = [];

    for (const [code, league] of Object.entries(ESPN_LEAGUES)) {
        const [legacy, espn] = await Promise.all([
            getJson(
                `https://www.thesportsdb.com/api/v2/json/list/teams/${league.sportsDbId}`,
                headers,
            ),
            espnTeams(league),
        ]);
        const index = indexByKey(espn, espnKeys);
        const espnNames = new Map(
            espn.map((t) => [String(t.id), t.displayName]),
        );
        for (const team of legacy.list || []) {
            const key = `${team.idTeam}|${league.sportsDbId}`;
            const espnId =
                key in overrides ? overrides[key] : match(team, index);
            if (espnId && espnNames.has(espnId)) {
                map[key] = `${code}|${espnId}`;
            } else if (espnId !== null || !(key in overrides)) {
                misses.push(
                    `${key}  ${code}  ${team.strTeam}${espnId ? `  (override ${espnId} not in ESPN list)` : ""}`,
                );
            }
        }
        console.error(`${code}: ${(legacy.list || []).length} legacy teams`);
    }

    const sorted = Object.fromEntries(
        Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
    console.error(`✅ ${Object.keys(map).length} mapped → ${OUT}`);
    console.error(`❌ ${misses.length} unmapped:\n${misses.join("\n")}`);

    const mappedTeamIds = new Set(Object.keys(map).map((k) => k.split("|")[0]));
    const unmappedChecks = checkIds.filter((id) => !mappedTeamIds.has(id));
    if (checkIds.length) {
        console.error(
            unmappedChecks.length
                ? `🚫 check failed, unmapped: ${unmappedChecks.join(" ")}`
                : `✅ all ${checkIds.length} checked ids map`,
        );
    }
    process.exitCode = unmappedChecks.length ? 1 : 0;
}

await main();
