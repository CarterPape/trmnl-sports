# TRMNL Sports Plugin

A TRMNL plugin that shows a team's next game across multiple sports leagues. Powered by a Cloudflare Worker that reads ESPN's undocumented site API.

For general TRMNL plugin dev guidance (local preview, xhrSelectSearch, etc.) see `../CLAUDE.md`.

## Project structure

```txt
.trmnlp.yml            # Local preview config (not committed — create locally)
src/
  settings.yml         # Plugin config, polling URL, field definitions
  full.liquid          # Full-screen layout
  half_horizontal.liquid
  half_vertical.liquid
  quadrant.liquid
  shared.liquid        # Shared partials (date_time + badge templates)
scripts/
  render-gallery.sh    # Visual contact sheet of every render state (see "Visual gallery")
test/
  fixtures/
    next-game-responses/  # One /next-game JSON per render state, fed to the gallery
cloudflare-worker/     # Backend (deployed at trmnl-sports.carter-pape.workers.dev)
  index.js             # Router + I/O handlers (fetch, cache, telemetry)
  lib/                 # Pure logic, unit-tested (see "Testing")
    leagues.js         # ESPN_LEAGUES: code → { path, label, soccer?, college? }
    espn.js            # ESPN URL builders + parsers → provider-neutral Event
    next-game.js       # Event typedef, upcoming/select, sliding TTL, payload formatting
    team-param.js      # espn|code|id and legacy TEAM_ID|LEAGUE_ID → ESPN ref
    legacy-team-ids.json  # Frozen map: legacy TheSportsDB "team|league" → "code|espnId"
    localization.js    # locale/tz parse, date/time labels, messages, as-of marker
    search.js          # matchRank, searchTier, searchTeams
    badge.js           # computeBadgeStats (invert + trim pixel math)
    client.js          # UA bucket + test/prod source for telemetry
  test/                # vitest unit tests (one file per lib module)
    integration/       # fetch-boundary handler tests (Workers pool) — see "Testing"
    fixtures/espn/     # Captured ESPN responses
  vitest.config.js     # Two projects: lib (Node) + integration (Workers pool)
  wrangler.toml        # Wrangler deploy config
  package.json         # Worker npm deps (upng-js; vitest + pool + coverage dev deps)
```

## Publication

- **GitHub:** <https://github.com/CarterPape/trmnl-sports> (public)
- **TRMNL plugin ID:** 271063 (name: "Next Game")

## Cloudflare Worker

Deployed at: `https://trmnl-sports.carter-pape.workers.dev`. No secrets: ESPN's site API is unauthenticated.

**Rate limiting:** two Workers Rate Limiting bindings in `wrangler.toml`.

- `RATE_LIMITER` (inbound): 50 requests/minute per IP. It's tuned high for `xhrSelectSearch` keystroke fan-out, since TRMNL provides no client-side debounce.
- `ESPN_LIMITER` (outbound): 60 ESPN calls/minute.

Every outbound call goes through `espnFetch`, which never throws. A 403 or 429 from ESPN sets a 15-minute per-colo cooldown (`/_espn-cooldown`), during which no ESPN call is made. No custom User-Agent; keep it that way.

**Caching** (`caches.default`, synthetic GET keys under the worker's own hostname):

- **Schedule**: the normalized `Event[]` per team (`/_espn-schedule`), stored for 7 days (`LKG_CACHE_TTL`) with an `X-Fetched-At` stamp. Freshness is a sliding TTL from `scheduleTtlSeconds`: 2h when the next game is within 48h, 12h otherwise, 24h when nothing is upcoming. Past that, the entry is held as last-known-good while the worker refreshes. A failed refresh writes a 5-minute per-team backoff (`/_espn-backoff`).
- **Team record**: 30 days (`ESPN_TEAM_CACHE_TTL`), used for the no-game screen's badge and name.
- **Team index** for `/teams`: 24h. **Per-query** `/teams` responses: 24h.
- **Badge analysis**: 30 days (see below).

Cache keys carry version strings (e.g. `/_team-index-espn-v3`, `v: "espn-tiers-2"`). Bump them when the cached shape changes; see the `wrangler dev --remote` cache warning in `../CLAUDE.md`.

**Graceful degradation (ESPN outage):** when the refresh fails but a stored schedule exists, `/next-game` serves the payload built from it with `stale: true` and a localized `as_of_label` ("as of 7:00 p.m."). Templates render a subtle staleness marker via the `stale_note` partial. Upcoming-filtering runs at serve time, so a stale schedule never re-serves a game that has already started.

With nothing stored, the response is `{ found: false, outage: true, not_found_message: <localized "Schedule unavailable"> }`. It's branded from the cached team record when one exists, but never fetches one. Telemetry tags `outcome: "stale"` (last-known-good saved the screen) vs `outcome: "upstream_fail"` (the outage reached the screen).

**CORS:** Only `/teams` returns CORS headers (it's browser-fetched via xhrSelectSearch). `/next-game` is server-polled by TRMNL and returns no CORS. `OPTIONS /next-game` returns 405.

**Badge analysis (invert + trim):** The worker decodes each badge PNG once (via `upng-js`) in `analyzeBadge`; one pixel pass yields `{ invert, trim }`, cached per badge URL as JSON for 30 days (cache key `/_badge-analysis`, TTL `BADGE_ANALYSIS_CACHE_TTL`). The `/next-game` response carries `*_badge_invert` and `*_badge_trim` for both teams (and `team_badge_*` in the not-found state).

- **`invert`** — mean Rec. 709 luminance of opaque pixels > `WHITE_BADGE_LUMA_THRESHOLD` (200/255). White-on-transparent logos vanish after `image-dither` against the device's white background, so templates apply `filter: invert(1)`.
- **`trim`** — opaque content bounding box as canvas fractions `{x,y,w,h}` (`{0,0,1,1}` = no trim, the decode-failure fallback). Logos are square canvases with varying transparent padding; untrimmed, marks render at inconsistent sizes and the `@` sits asymmetrically between them.

The shared `badge` partial (`shared.liquid`) consumes both. It clips each badge to its content via an `overflow: hidden` wrapper, sized by the layout's `h--`/`w--` class with `aspect-ratio` = content ratio. The `<img>` is scaled (`width: calc(100% / w)`) and `transform: translate`d so only the opaque content shows, plus the invert filter when flagged. Every mark then renders edge-to-edge and hugs the `@`, self-maintaining for any team.

`half_vertical` sizes its side-by-side badges by **height** (not width) so trimmed marks stay equal-height and aligned, matching `full`/`half_horizontal`. The wrapper's aspect/width caps are `max-height`, and must stay `max-height` — as an inline `height` they override the `h--N` class and a `var()` that fails to resolve then degrades to `auto`, which un-clips the wrapper and balloons the badge off-screen (archived pape-doc 0088). Full design + rejected alternatives: archived pape-doc 0067.

Why per-pixel, not CSS-only: a single CSS transform can't fix both logo polarities — `mix-blend-mode: difference` over white inverts white-on-transparent logos to black but symmetrically *breaks* black-on-transparent ones (e.g. Spurs) into invisible-white. And a flex `justify-content` tweak can't center the `@`, because the transparent padding lives *inside* the square `<img>`: flex moves the box, not the centered mark within it. Per-pixel measurement is the only universal fix for both.

### Endpoints

**`POST /teams` (or `GET /teams?q=SEARCH_TERM`)**

- Searches a cached index of every team in `ESPN_LEAGUES` (POST body: `{"query": "..."}`). The index is built lazily from one `/{path}/teams?limit=1000` call per league, plus the FBS and FCS division standings for search tiers, then cached 24h per POP.
- Case-insensitive substring match (`searchBlob`). Ranked by match (name prefix → name-token prefix → substring), then tier (pro → FBS → other D-I → lower divisions), then alphabetical. Capped at 20.
- Tiers: ESPN shares one id per school across sports, so a school's football division ranks its basketball rows too. The standings come from the **site** API: ESPN's core API 403s Cloudflare egress. If the standings are unavailable, every college ties.
- Returns TRMNL xhrSelectSearch format: `[{"id": "espn|CODE|ESPN_ID", "name": "Team Name (League)"}]`.
- Minimum 2 characters required.

**`GET /next-game?team=espn|CODE|ESPN_ID&type=any|home|away&locale=LOCALE&tz=IANA_TZ&device=FRIENDLY_ID`**

- `team` arrives in one of two forms, plus TRMNL's `::label` suffix (resolved in `lib/team-param.js`):
    - `espn|CODE|ESPN_ID` — what installs since the ESPN move store.
    - Legacy `TEAM_ID|LEAGUE_ID` — the TheSportsDB form older installs still send. It's translated through the frozen `legacy-team-ids.json` forever; never regenerate it.
    - Anything unresolvable (junk, or a legacy id the map doesn't carry) gets `{ found: false, not_found_message }` with `outcome: "missing_team"` and no upstream call.
- Schedule fetches use `scheduleUrls` in `lib/espn.js`:
    - **US leagues** merge `seasontype=2` (regular) and `3` (postseason). If nothing is upcoming, they also try next season's regular season (`nextSeasonUrl`), which covers the off-season.
    - **Soccer** uses `soccer/all/teams/{id}/schedule?fixture=true`, which spans every competition the club is in. So cup and continental fixtures appear, and home/away filtering happens locally.
- The title-bar `team_league_label` is the league's `label` from `ESPN_LEAGUES`, so it stays stable across cup fixtures.
- `locale` and `tz` come from `{{ trmnl.user.locale }}` / `{{ trmnl.user.time_zone_iana }}`. The worker uses them to localize `date_label` ("Today", "Heute", "Wednesday, May 1") and `time_label` ("7:00 p.m.", "19:00"). Both have a placeholder guard: a literal `{{...}}` falls back to en-US/UTC. A game whose time ESPN marks TBD (`timeValid: false`) gets a date and no time.
- **Found**: a flat payload from `formatNextGame` (`lib/next-game.js`).
- **Not found**: `formatNoGame` returns the configured team's badge/name/league with one of two localized messages. "Schedule unavailable" means nothing is upcoming at all (`unavailableMessage`); "No game found" means games exist, but none match the home/away filter (`notFoundMessage`).
- Stale and outage variants are described under "Graceful degradation" above.

### ESPN API

- Base: `https://site.api.espn.com/apis/site/v2/sports`. No key, no documented terms; Disney's ToS forbids it on paper, and 2026 saw 403 waves. The cooldown + `ESPN_LIMITER` + long caches are the mitigation.
- Endpoints used: `/{path}/teams?limit=1000`, `/{path}/teams/{id}`, `/{path}/teams/{id}/schedule?…`, and `football/college-football` standings by group (80 = FBS, 81 = FCS).
- `ESPN_LEAGUES` in `lib/leagues.js` is the supported-league list and the dropdown label source. Adding a league is one entry there (plus `soccer: true` / `college: true` where they apply).

### Supported leagues

| Code | League | ESPN path |
| --- | --- | --- |
| `nhl` | NHL | `hockey/nhl` |
| `nba` | NBA | `basketball/nba` |
| `mlb` | MLB | `baseball/mlb` |
| `wnba` | WNBA | `basketball/wnba` |
| `nwsl` | NWSL | `soccer/usa.nwsl` |
| `mbb` | NCAA Men's Basketball | `basketball/mens-college-basketball` |
| `wbb` | NCAA Women's Basketball | `basketball/womens-college-basketball` |
| `nfl` | NFL | `football/nfl` |
| `cfb` | NCAA Football | `football/college-football` |
| `mls` | MLS | `soccer/usa.1` |
| `afl` | AFL | `australian-football/afl` |
| `epl` | English Premier League | `soccer/eng.1` |
| `laliga` | Spanish La Liga | `soccer/esp.1` |
| `bundesliga` | German Bundesliga | `soccer/ger.1` |
| `seriea` | Italian Serie A | `soccer/ita.1` |
| `ligue1` | French Ligue 1 | `soccer/fra.1` |

### Redeploy after changes

```bash
cd cloudflare-worker
npm install   # if node_modules/ is missing (gitignored)
npx wrangler deploy
```

Stream live logs:

```bash
npx wrangler tail
```

### Observability

Every request emits one telemetry record from `emit()` in `index.js`, to two sinks (both free-tier, configured in `wrangler.toml`):

- **Workers Logs** (`[observability] enabled = true`) — a structured `console.log` line tagged `"evt":"req"` with `endpoint`/`outcome`/`cache`/`upstream`/`latencyMs`/config dims. For per-request debugging. 7-day retention.
- **Analytics Engine** (`[[analytics_engine_datasets]]`, binding `ANALYTICS`, dataset `trmnl_sports_requests`) — one `writeDataPoint` per request for aggregate trends (cache-hit ratio, upstream error rate, volume, latency, distinct-config install proxy). 3-month retention. The **column order is a permanent positional contract** — see `cloudflare-worker/observability-queries.md` for the schema and canonical SQL.

`emit()` is the single writer (built from a per-request collector threaded through the handlers); the top-level `fetch` is wrapped in `try/catch/finally` so every path — including a thrown exception (`outcome: "error"`, a recorded 500) — emits exactly once.

**Separating real traffic from test — use `device`, not the UA bucket.** `emit()` records a `client` UA bucket and a `source` (`test` iff `?test=1`, else `prod`) via pure `lib/client.js`, plus `device` (`trmnl.device.friendly_id`) on `next-game`.

The UA bucket does NOT identify provenance. TRMNL's real poller and our own `trmnlp`/`curl` share UAs (see `../CLAUDE.md`), so never derive test vs prod from it. **The reliable real-install signal is `device != ''`**: local `trmnlp` sends the literal `{{...}}`, and curl sends nothing. For a real-world read, filter `blob12 != ''`; `COUNT(DISTINCT blob12)` ≈ unique installs. **Append `&test=1` to any manual/dev hit** (curl, browser, `wrangler dev --remote` override).

`provider` (blob13) is always `espn` now. `idform` (blob14) splits `espn` installs from `legacy` ones still sending a TheSportsDB id.

Gotchas:

- **AE bindings don't exist in local `wrangler dev`** — `emit()` guards with `env.ANALYTICS?.`, so dev runs fine but writes nothing. Use `wrangler dev --remote` to exercise AE against the real binding.
- **Backgrounded / non-TTY `wrangler dev` does not surface worker `console.log`** (it streams worker logs over the DevTools inspector channel, only rendered interactively; the `[wrangler:info] METHOD PATH STATUS` request lines are a separate always-on logger). Don't conclude logging is broken from a piped dev session — verify logs via `wrangler tail`, the dashboard Query Builder, or the `cloudflare-observability` MCP (`query_worker_observability`) against the deployed worker. (Running dev under a real TTY via `script` instead triggers wrangler's interactive "install skills?" prompt and blocks.)

## Testing

Three layers, deliberately separate (full rationale in the testing-session pape-docs):

### Worker logic (unit tests)

The worker's pure logic lives in `cloudflare-worker/lib/` so it's importable and testable without bindings. These run in plain Node via **vitest** (the `lib` project) — no Workers runtime needed, because nothing under test touches it (`Intl`/`Response`/`Request` are Node globals; `computeBadgeStats` takes a raw RGBA array, so no `upng`). The handler integration layer below *does* run under `@cloudflare/vitest-pool-workers`; one `npm test` runs both projects.

```bash
cd cloudflare-worker
npm install        # vitest + @cloudflare/vitest-pool-workers + coverage-istanbul
npm test           # vitest run — BOTH projects (lib + integration)
npm run test:watch
```

Time-dependent functions take an optional `nowMs` (default `Date.now()`) so tests pin "now". ESPN parsing is tested against captured responses in `test/fixtures/espn/`. The deferred full handler split → thin-router `index.js` is written up in `pape-docs/0073`.

### Handler integration tests (`test/integration/`)

The I/O handlers and the router are tested at the **`fetch` boundary** — `worker.fetch(request, env, ctx)` called directly in real `workerd` via `@cloudflare/vitest-pool-workers`, with a **hand-built `env`** (not config bindings) so the telemetry datapoint and the rate-limit/error branches are assertable. Boundary tests are invariant under the deferred 0073 handler split — that's the point: a green run proves the move preserved behavior. Design: `pape-docs/0076`.

- `_harness.js` — `makeEnv()` (stub `RATE_LIMITER`, spy `ANALYTICS`), `decodeDatapoint()` (pins the AE positional column contract), `installFetchMock()`, `makeBadgePng()`.
- Coverage: router 404, `/teams`, the `/next-game` ESPN matrix (`next-game-espn.test.js`: legacy-id translation, cache sharing, stale/outage, cooldown, unmapped ids), and a real-`upng` badge decode smoke (`next-game-badge.test.js`).
- Integration test files share one `caches.default`, so give each file its own team ids.

Toolchain gotchas:

- **Default-import CJS deps:** `import UPNG from "upng-js"`, *not* `import * as`. The pool's Vite/rollup bundler exposes a CJS module's exports only under `.default`, while wrangler's esbuild spreads them onto the namespace; the default import resolves under both (and Node). With `import * as`, `UPNG.decode` is `undefined` under the pool and decode silently hits its fallback. Prod (esbuild) is unaffected, but tests are — so reach for the default import for any CJS dep the handlers call.
- **Mock outbound `fetch` with `vi.stubGlobal("fetch", …)`** (wrapped in `installFetchMock`) — the pool's old `fetchMock` from `cloudflare:test` is gone in 0.16. The worker shares the test isolate, so a global stub applies to it.
- **Coverage uses the Istanbul provider** (`@vitest/coverage-istanbul`), not V8 — the pool doesn't support native V8 coverage. `npx vitest run --coverage` reports on `index.js` (no `fail_under` gate yet).
- **Dependabot alerts here are dev-toolchain-only, and the pool's `0.x` range hides the fix.** Every alert this repo has raised came in transitively through the pool/vitest (vite, esbuild, undici, postcss, sharp, `@babel/core`); the sole runtime dep is `upng-js`, so none of it reaches the deployed worker. Because the pool is `0.x`, a `^0.16.x`-style caret **cannot** reach a patched `0.20.x` — so alerts accumulate until the range itself is bumped, and Dependabot files one PR per package instead. Bump the pool first and most of them evaporate at once. Never take `npm audit fix --force` here: it "fixes" undici by *downgrading* the pool to 0.8.71, which is flagged for esbuild, miniflare, and wrangler simultaneously. `package.json` carries an `overrides` floor of `undici: ^7.29.0` (miniflare exact-pins 7.28.0, the top of the advisory range) — keep it a **caret, not `>=`**, which resolves to undici 8.x and jumps a major past what miniflare expects; drop it once miniflare ships a fixed pin.

### Visual rendering (`scripts/render-gallery.sh`)

Templates render to dithered e-ink PNGs you *look at*, so the visual layer is a human-eyeball contact sheet, not pixel-diff. The gallery renders every fixture in `test/fixtures/next-game-responses/` across all four views into one labeled contact sheet.

```bash
scripts/render-gallery.sh                       # all states × 4 views → contact sheet
scripts/render-gallery.sh --view full           # one view across all states
scripts/render-gallery.sh --device v2           # render on TRMNL X
```

It's **hermetic**: it serves the fixtures over a local static server and points `variables.trmnl.plugin_settings.polling_url` at them, so the fixture *is* the polled response — edge states the live backend won't produce on demand (stale, outage, long names) render exactly. It backs up and restores your real `.trmnlp.yml`. Because trmnlp reads config (and re-polls) only at startup, the managed `trmnlp serve` is restarted once per fixture (~30s each) — a full run is a few minutes; it's an occasional check. Output lands in `$TMPDIR/trmnl-sports-gallery/`; the combined sheet path prints on stdout. To add a render state, drop another `*.json` (a full `/next-game` response) into the fixtures dir.

## TRMNL plugin settings

- **Team** (`team_id`): `xhrSelectSearch` — calls Worker `/teams` as the user types. Stores `espn|CODE|ESPN_ID` as the value.
- **Game Filter** (`game_type`): static select — `any` / `home` / `away`
- **Polling URL:** `https://trmnl-sports.carter-pape.workers.dev/next-game?team={{ team_id }}&type={{ game_type }}&locale={{ trmnl.user.locale }}&tz={{ trmnl.user.time_zone_iana }}&device={{ trmnl.device.friendly_id }}`. The `device` param logs the per-device friendly_id for the unique-install count (see Observability). On real installs, `{{ team_id }}` interpolates *with* a `::Display Name` suffix (e.g. `espn|mlb|2::Boston Red Sox (MLB)`).
- **Title bar:** All four layouts include a `title_bar` sibling to `layout` with `<span class="title">Next Game</span>` plus a per-instance `<span class="instance">` carrying the configured team. `full` and `half_horizontal` show `{{ team_name }} ({{ team_league_label }})`; `half_vertical` and `quadrant` drop the league to avoid overflow with long names. No icon — TRMNL's [recipe-publishing tips](https://trmnl.com/blog/plugin-recipe-publishing-tips) explicitly warn against using the default `trmnl--render.svg`, and the framework docs don't require a title-bar icon.
- **Refresh interval:** "Every 15 mins" is a max-refresh *ceiling*, not a cadence (see `../CLAUDE.md`). Worker poll volume reflects render events, not install count.

## Local preview `.trmnlp.yml`

```yaml
custom_fields:
  team_id: "espn|CODE|ESPN_ID"   # find via: curl "https://trmnl-sports.carter-pape.workers.dev/teams?q=Chicago&test=1"
  game_type: "any"               # any | home | away
```

## Known open items

- **ESPN fragility** — undocumented API, no fallback source. If ESPN starts blocking Cloudflare egress for good, `/next-game` degrades to stale and then outage screens.
