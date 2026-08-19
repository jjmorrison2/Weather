// The almanac: turns the year of daily station records into stories —
// records, streaks, and a feed of notable weather events.

const Almanac = {
  // Records & streaks across the year to date.
  records(daily, todayISO) {
    const rows = [...daily.values()].filter((r) => r.date <= todayISO)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return null;

    const best = (key, cmp) => rows.reduce((a, b) =>
      (b[key] != null && (a[key] == null || cmp(b[key], a[key]))) ? b : a, rows[0]);

    const wettest = best('precip', (a, b) => a > b);
    const hottest = best('tempHigh', (a, b) => a > b);
    const coldest = best('tempLow', (a, b) => a < b);
    const windiest = best('gustHigh', (a, b) => a > b);

    const rainDays = rows.filter((r) => (r.precip ?? 0) >= 0.01).length;

    // Streaks (walk backward from today for current; scan all for longest).
    let curDry = 0, curWet = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const wet = (rows[i].precip ?? 0) >= 0.01;
      if (rows[i].precip == null) break;
      if (!wet && curWet === 0) curDry++;
      else if (wet && curDry === 0) curWet++;
      else break;
    }
    let longestDry = 0, run = 0;
    for (const r of rows) {
      if ((r.precip ?? 0) < 0.01) { run++; longestDry = Math.max(longestDry, run); }
      else run = 0;
    }

    return { wettest, hottest, coldest, windiest, rainDays, curDry, curWet, longestDry, days: rows.length };
  },

  // Notable-event feed for the last `windowDays` days, newest first.
  // Multi-day heat waves and dry spells are collapsed into single events.
  events(daily, todayISO, windowDays = 120) {
    const from = Util.addDaysISO(todayISO, -windowDays);
    const rows = [];
    for (let d = from; d <= todayISO; d = Util.addDaysISO(d, 1)) {
      const r = daily.get(d);
      if (r) rows.push(r);
    }
    const year = [...daily.values()].filter((r) => r.date <= todayISO);
    const rankOfRain = (v) => 1 + year.filter((r) => (r.precip ?? 0) > v).length;

    const events = [];
    const span = (a, b) => a === b ? Util.weekdayDate(a) : `${Util.shortDate(a)} – ${Util.shortDate(b)}`;

    // Single-day events.
    for (const r of rows) {
      if ((r.precip ?? 0) >= 0.75) {
        const rank = rankOfRain(r.precip);
        events.push({
          date: r.date, end: r.date, icon: r.precip >= 1.5 ? '⛈️' : '🌧️', kind: 'rain',
          title: `${Util.fmtIn(r.precip)} of rain`,
          detail: rank === 1 ? 'Wettest day of the year so far'
            : rank <= 3 ? `#${rank} wettest day of the year` : 'A soaking day',
          weight: r.precip,
        });
      }
      if ((r.gustHigh ?? 0) >= 35) {
        events.push({
          date: r.date, end: r.date, icon: '💨', kind: 'wind',
          title: `Gusts to ${Math.round(r.gustHigh)} mph`,
          detail: 'High-wind day at the station', weight: r.gustHigh / 20,
        });
      }
      if ((r.tempLow ?? 99) <= 10) {
        events.push({
          date: r.date, end: r.date, icon: '🥶', kind: 'cold',
          title: `Low of ${Math.round(r.tempLow)}°`,
          detail: 'Bitter-cold morning', weight: 2,
        });
      }
    }

    // Runs: heat (high ≥ 95), freeze days (high ≤ 32), dry spells (≥ 10 days).
    const runsOf = (test) => {
      const out = [];
      let start = null, prev = null;
      for (const r of rows) {
        if (test(r)) { if (!start) start = r.date; prev = r.date; }
        else if (start) { out.push([start, prev]); start = null; }
      }
      if (start) out.push([start, prev]);
      return out;
    };
    for (const [a, b] of runsOf((r) => (r.tempHigh ?? 0) >= 95)) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
      const peak = Math.max(...rows.filter((r) => r.date >= a && r.date <= b).map((r) => r.tempHigh ?? 0));
      events.push({
        date: a, end: b, icon: '🔥', kind: 'heat',
        title: days > 1 ? `${days}-day stretch at 95°+` : `High of ${Math.round(peak)}°`,
        detail: days > 1 ? `Peaked at ${Math.round(peak)}° (${span(a, b)})` : 'Scorcher',
        weight: days + peak / 100,
      });
    }
    for (const [a, b] of runsOf((r) => (r.tempHigh ?? 99) <= 32)) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
      events.push({
        date: a, end: b, icon: '🧊', kind: 'cold',
        title: days > 1 ? `${days} days below freezing` : 'Sub-freezing day',
        detail: `High never broke 32° (${span(a, b)})`, weight: days,
      });
    }
    for (const [a, b] of runsOf((r) => (r.precip ?? 0) < 0.01)) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
      if (days >= 12) {
        events.push({
          date: a, end: b, icon: '🌵', kind: 'dry',
          title: `${days}-day dry spell`,
          detail: `No measurable rain ${span(a, b)}`, weight: days / 4,
        });
      }
    }

    events.sort((x, y) => (x.end < y.end ? 1 : x.end > y.end ? -1 : y.weight - x.weight));
    return events.slice(0, 9);
  },

  // Month-to-date and year-to-date vs the NOAA normals.
  vsNormal(daily, todayISO) {
    const y = todayISO.slice(0, 4);
    const sum = (from) => {
      let s = 0, have = false;
      for (let d = from; d <= todayISO; d = Util.addDaysISO(d, 1)) {
        const v = daily.get(d)?.precip;
        if (v != null) { s += v; have = true; }
      }
      return have ? s : null;
    };
    const mtd = sum(todayISO.slice(0, 8) + '01');
    const ytd = sum(`${y}-01-01`);
    return {
      mtd, mtdNormal: Util.normalMonthToDate(todayISO),
      ytd, ytdNormal: Util.normalToDate(todayISO),
    };
  },
};
