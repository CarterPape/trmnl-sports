// Next-game selection and the /next-game payload, over the provider-neutral Event shape.

import {
    localizeDayLabel,
    localizeTimeLabel,
    ymdInZone,
} from "./localization.js";

/**
 * @typedef {{ id: string, name: string, badge: string|null }} Side
 * @typedef {{
 *   id: string,
 *   startUtc: string,
 *   timeKnown: boolean,
 *   date: string,
 *   status: "scheduled"|"live"|"final"|"postponed"|"canceled",
 *   competition: string,
 *   venue: string,
 *   home: Side,
 *   away: Side,
 * }} Event
 */

const UPCOMING_GRACE_MS = 4 * 60 * 60 * 1000;
const HOUR_S = 60 * 60;
const NEAR_GAME_MS = 48 * HOUR_S * 1000;

const DONE_STATUSES = new Set(["final", "postponed", "canceled"]);

export function isEventUpcoming(event, tz = "UTC", nowMs = Date.now()) {
    if (DONE_STATUSES.has(event.status)) return false;
    if (!event.timeKnown) return event.date >= ymdInZone(new Date(nowMs), tz);
    return Date.parse(event.startUtc) > nowMs - UPCOMING_GRACE_MS;
}

export function upcomingEvents(events, tz = "UTC", nowMs = Date.now()) {
    return (events || [])
        .filter((e) => isEventUpcoming(e, tz, nowMs))
        .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export function selectNextGame(
    events,
    type,
    teamId,
    tz = "UTC",
    nowMs = Date.now(),
) {
    return (
        upcomingEvents(events, tz, nowMs).find((e) => {
            if (type === "home") return e.home.id === teamId;
            if (type === "away") return e.away.id === teamId;
            return true;
        }) || null
    );
}

export function scheduleTtlSeconds(events, nowMs = Date.now()) {
    const next = upcomingEvents(events, "UTC", nowMs)[0];
    if (!next) return 24 * HOUR_S;
    if (Date.parse(next.startUtc) - nowMs < NEAR_GAME_MS) return 2 * HOUR_S;
    return 12 * HOUR_S;
}

export function formatNextGame(
    event,
    {
        teamId,
        homeInvert,
        awayInvert,
        homeTrim,
        awayTrim,
        locale,
        tz,
        leagueLabel,
        nowMs = Date.now(),
    },
) {
    const gameMs = Date.parse(event.startUtc);
    const ours = event.home.id === teamId ? event.home : event.away;
    return {
        found: true,
        home_team: event.home.name,
        away_team: event.away.name,
        home_team_badge: event.home.badge,
        away_team_badge: event.away.badge,
        home_team_badge_invert: homeInvert,
        away_team_badge_invert: awayInvert,
        home_team_badge_trim: homeTrim,
        away_team_badge_trim: awayTrim,
        start_utc_timestamp: event.startUtc,
        date_label: event.timeKnown
            ? localizeDayLabel(
                  ymdInZone(new Date(gameMs), tz),
                  locale,
                  tz,
                  nowMs,
              )
            : localizeDayLabel(event.date, locale, tz, nowMs),
        time_label: event.timeKnown
            ? localizeTimeLabel(gameMs, locale, tz)
            : "",
        venue: event.venue,
        league: event.competition,
        team_name: ours.name,
        team_league_label: leagueLabel,
    };
}

export function formatNoGame({ team, invert, trim, leagueLabel, message }) {
    return {
        found: false,
        team_badge: team?.badge || null,
        team_badge_invert: invert,
        team_badge_trim: trim,
        team_name: team?.name || "",
        team_league_label: leagueLabel,
        not_found_message: message,
    };
}
