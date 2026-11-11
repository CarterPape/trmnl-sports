# Next Game

<img src="logo.png" alt="Next Game logo" width="120" align="right">

A [TRMNL](https://usetrmnl.com) plugin that shows your favorite team's next scheduled game. Pick a team, pick a filter (any / home / away), and your TRMNL displays the matchup, date, time, and venue — refreshed every 15 minutes.

![Plugin preview](preview.png)

## Features

- **Many sports, many countries** — every major North American team-sport league, top-flight European soccer, and the AFL. See the [full list](#supported-leagues) below.
- **Home/away filtering** — show only home games, only away games, or any next game.
- **Local time** — game times render in the timezone configured on your TRMNL device.
- **Multiple layouts** — full-screen, half-horizontal, half-vertical, and quadrant variants are all included.
- **E-ink-aware logos** — team badges that would otherwise render invisible on the device's white background (e.g. Trail Blazers' white-on-transparent shield) are auto-detected and inverted so they show up.

## Setup

1. Install **Next Game** from the TRMNL plugin marketplace.
2. In the plugin settings, type your team's **city, team name, or mascot** in the **Team** field — `Chicago`, `Bulls`, and `Chicago Bulls` all return the Bulls — then select your team from the dropdown.
3. Choose a **Game Filter**: any next game, next home game, or next away game.

## Supported leagues

### North America

| League | Sport |
| --- | --- |
| NHL | Hockey |
| NBA | Basketball |
| MLB | Baseball |
| NFL | American football |
| MLS | Soccer |
| WNBA | Basketball |
| NWSL | Soccer |
| NCAA Division I Men's Basketball | Basketball |
| NCAA Division I Women's Basketball | Basketball |
| NCAA Football | American football |

### Europe (soccer)

| League | Country |
| --- | --- |
| Premier League | England |
| La Liga | Spain |
| Bundesliga | Germany |
| Serie A | Italy |
| Ligue 1 | France |

### Australia

| League | Sport |
| --- | --- |
| AFL | Australian rules football |

If your league isn't here, please [open an issue](https://github.com/CarterPape/trmnl-sports/issues) — adding leagues is usually a small change as long as ESPN covers them.

## How it works

The plugin polls a small [Cloudflare Worker](cloudflare-worker/index.js) at `trmnl-sports.carter-pape.workers.dev`, which in turn reads ESPN's public (undocumented) site API. The Worker:

- Maintains a local index of every team across the supported leagues, refreshed daily. Team search is a substring scan against that index, so mascot-only queries like `Bulls` work, and pro teams rank ahead of college ones.
- Caches each team's schedule, refreshing it more often as game day approaches, to keep ESPN load light. If ESPN is unreachable, the last-known schedule keeps showing, marked with when it was fetched.
- Pre-computes a per-badge "needs inversion" flag by sampling each team logo's pixel luminance, so the templates can render white-on-transparent badges visibly.

If you'd rather host the Worker yourself, see [Self-hosting](#self-hosting) below.

## Self-hosting

You can run your own copy of the Worker if you want full control over the backend.

### Requirements

- A [Cloudflare](https://dash.cloudflare.com) account (Workers free tier is sufficient).
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed: `npm install -g wrangler`

### Deploy

```bash
git clone https://github.com/CarterPape/trmnl-sports.git
cd trmnl-sports/cloudflare-worker
npm install
wrangler login
npx wrangler deploy
```

After deploy, update `polling_url` and the `endpoint:` field in `src/settings.yml` to point to *your* Worker URL, then `trmnlp push` your fork.

### Local preview

The repo is `trmnlp`-compatible. See the [parent repo's README](../) for the local-preview prerequisites (Ruby 3.4.9 via rbenv, Firefox + geckodriver, ImageMagick). Then create a `.trmnlp.yml` (gitignored) with a real team ID:

```yaml
custom_fields:
    team_id: "espn|CODE|ESPN_ID"   # find via: curl "https://trmnl-sports.carter-pape.workers.dev/teams?q=Chicago"
    game_type: "any"               # any | home | away
```

…then run `trmnlp serve` from the project root.

## Known limitations

- Only the leagues listed above are searchable. Tennis, F1, and tournament-only competitions (e.g. World Cup, UEFA Champions League as a standalone selection) aren't supported.
- The plugin shows one upcoming game at a time — not a full schedule.
- Game times come from ESPN; when a start time isn't set yet (TBD), only the date is shown.
- A game advances off the screen once ESPN marks it final, or four hours after its start if ESPN hasn't.

## Issues and contributions

Bug reports and feature requests are welcome at <https://github.com/CarterPape/trmnl-sports/issues>.

## License

Copyright © 2026 Carter Pape.

Released under the [GNU General Public License v3.0 or later](LICENSE). The Cloudflare Worker source, Liquid templates, and assets in this repository are all GPL-licensed; if you fork or self-host, your modifications must be released under the same terms.

Schedules and team logos come from ESPN. This project isn't affiliated with or endorsed by ESPN.
