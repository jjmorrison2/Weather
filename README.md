# Columbia, MO — Personal Weather Dashboard

A self-contained weather dashboard for PWS **[KMOCOLUM262](https://www.wunderground.com/dashboard/pws/KMOCOLUM262)**
(Columbia, MO), backed up by NWS station **[KCOU](https://forecast.weather.gov/data/obhistory/KCOU.html)**
at Columbia Regional Airport (~4 miles away).

No build step, no server-side code, no dependencies — just open `index.html`.

## What it shows

- **Current conditions** — live from your PWS (temp, humidity, wind, pressure,
  rain rate, today's rain, UV/solar), or from KCOU if no API key is set.
- **Precipitation totals** — today, yesterday, last 7 days, last 30 days,
  month-to-date, and year-to-date, plus a daily rainfall chart (30/60/90-day
  and full-year views) and a cumulative year-to-date chart.
- **Recent history** — a 14-day daily table (high/low, precip, wind, humidity)
  and a 30-day high/low temperature chart, plus the KCOU observation log
  (the API version of the forecast.weather.gov "3-Day History" page).
- **Forecast** — the NWS 7-day forecast and 48-hour hourly forecast for the
  station's exact grid point (LSX 25,84), with active watches/warnings shown
  at the top when there are any.

## Running it

Any static file server works:

```bash
cd Weather
python3 -m http.server 8080
# then open http://localhost:8080
```

Or publish it with **GitHub Pages**: repo Settings → Pages → deploy from
branch, root folder. The page is pure static HTML/JS, so that's all it takes.

## Getting real rain-gauge data (recommended)

Out of the box the dashboard works with no keys: forecasts and the KCOU log
come from the free NWS API, and precipitation history comes from
[Open-Meteo](https://open-meteo.com/) — a *modeled estimate* for your
coordinates, not your actual gauge.

To use the real readings from KMOCOLUM262:

1. As a PWS owner you get a free Weather Underground API key:
   sign in at wunderground.com → **My Profile → Member Settings →
   [API Keys](https://www.wunderground.com/member/api-keys)**.
2. Open the dashboard, click **⚙ Settings**, paste the key, and Save.

The key is stored only in your browser's `localStorage` — it is never
committed to the repo or sent anywhere except `api.weather.com`. With a key,
all precipitation totals, charts, and the daily history table come from your
station's own rain gauge, and the badge in the Precipitation section switches
to "From your rain gauge".

### API usage

The free WU tier allows 1,500 calls/day. The dashboard is conservative:
year-to-date history is fetched one month at a time and cached in
`localStorage` — past months are cached permanently, the current month for
30 minutes — so a typical day uses only a handful of calls. Live sections
refresh every 10 minutes.

## Data sources

| Data | Primary source | Fallback |
|---|---|---|
| Current conditions | WU PWS `observations/current` | NWS KCOU latest observation |
| Daily history & precip totals | WU PWS `history/daily` (the actual gauge) | Open-Meteo archive + recent-days model |
| 7-day / hourly forecast | NWS `api.weather.gov` gridpoint LSX 25,84 | — |
| Alerts | NWS active alerts for the station's coordinates | — |
| KCOU observation log | NWS `stations/KCOU/observations` | — |

## Adapting to another location

Edit `js/config.js`: set your PWS id and coordinates, then look up your NWS
grid at `https://api.weather.gov/points/{lat},{lon}` and copy
`gridId`/`gridX`/`gridY` and a nearby observation station id.

## Layout

```
index.html        page shell
css/style.css     styling (auto light/dark)
js/config.js      station ids, coordinates, NWS grid, refresh cadence
js/util.js        dates/units/formatting/cache helpers
js/sources.js     Weather Underground, NWS, and Open-Meteo clients
js/charts.js      dependency-free SVG charts
js/app.js         orchestration and rendering
```
