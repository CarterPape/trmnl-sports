// Keyed by the `<code>` in an `espn|<code>|<espnTeamId>` team param.

export const ESPN_LEAGUES = {
    nhl: { path: "hockey/nhl", label: "NHL" },
    nba: { path: "basketball/nba", label: "NBA" },
    mlb: { path: "baseball/mlb", label: "MLB" },
    wnba: { path: "basketball/wnba", label: "WNBA" },
    nwsl: {
        path: "soccer/usa.nwsl",
        label: "NWSL",
        soccer: true,
    },
    mbb: {
        path: "basketball/mens-college-basketball",
        label: "NCAA Men's Basketball",
        college: true,
    },
    wbb: {
        path: "basketball/womens-college-basketball",
        label: "NCAA Women's Basketball",
        college: true,
    },
    nfl: { path: "football/nfl", label: "NFL" },
    cfb: {
        path: "football/college-football",
        label: "NCAA Football",
        college: true,
    },
    mls: { path: "soccer/usa.1", label: "MLS", soccer: true },
    afl: { path: "australian-football/afl", label: "AFL" },
    epl: {
        path: "soccer/eng.1",
        label: "English Premier League",
        soccer: true,
    },
    laliga: {
        path: "soccer/esp.1",
        label: "Spanish La Liga",
        soccer: true,
    },
    bundesliga: {
        path: "soccer/ger.1",
        label: "German Bundesliga",
        soccer: true,
    },
    seriea: {
        path: "soccer/ita.1",
        label: "Italian Serie A",
        soccer: true,
    },
    ligue1: {
        path: "soccer/fra.1",
        label: "French Ligue 1",
        soccer: true,
    },
};
