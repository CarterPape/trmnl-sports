// Keyed by the `<code>` in an `espn|<code>|<espnTeamId>` team param; `sportsDbId` is what legacy team params carry.

export const ESPN_LEAGUES = {
    nhl: { path: "hockey/nhl", label: "NHL", sportsDbId: 4380 },
    nba: { path: "basketball/nba", label: "NBA", sportsDbId: 4387 },
    mlb: { path: "baseball/mlb", label: "MLB", sportsDbId: 4424 },
    wnba: { path: "basketball/wnba", label: "WNBA", sportsDbId: 4516 },
    nwsl: {
        path: "soccer/usa.nwsl",
        label: "NWSL",
        sportsDbId: 4521,
        soccer: true,
    },
    mbb: {
        path: "basketball/mens-college-basketball",
        label: "NCAA Men's Basketball",
        sportsDbId: 4607,
    },
    wbb: {
        path: "basketball/womens-college-basketball",
        label: "NCAA Women's Basketball",
        sportsDbId: 5789,
    },
    nfl: { path: "football/nfl", label: "NFL", sportsDbId: 4391 },
    cfb: {
        path: "football/college-football",
        label: "NCAA Football",
        sportsDbId: 4479,
    },
    mls: { path: "soccer/usa.1", label: "MLS", sportsDbId: 4346, soccer: true },
    afl: { path: "australian-football/afl", label: "AFL", sportsDbId: 4456 },
    epl: {
        path: "soccer/eng.1",
        label: "English Premier League",
        sportsDbId: 4328,
        soccer: true,
    },
    laliga: {
        path: "soccer/esp.1",
        label: "Spanish La Liga",
        sportsDbId: 4335,
        soccer: true,
    },
    bundesliga: {
        path: "soccer/ger.1",
        label: "German Bundesliga",
        sportsDbId: 4331,
        soccer: true,
    },
    seriea: {
        path: "soccer/ita.1",
        label: "Italian Serie A",
        sportsDbId: 4332,
        soccer: true,
    },
    ligue1: {
        path: "soccer/fra.1",
        label: "French Ligue 1",
        sportsDbId: 4334,
        soccer: true,
    },
};

export function leagueCodeForSportsDbId(sportsDbId) {
    const id = Number(sportsDbId);
    return (
        Object.keys(ESPN_LEAGUES).find(
            (code) => ESPN_LEAGUES[code].sportsDbId === id,
        ) || null
    );
}
