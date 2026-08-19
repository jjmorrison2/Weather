# Columbia Sky — a living weather observatory

A personal weather dashboard for PWS **[KMOCOLUM262](https://www.wunderground.com/dashboard/pws/KMOCOLUM262)**
(Columbia, MO), backed up by NWS station **[KCOU](https://forecast.weather.gov/data/obhistory/KCOU.html)**
at Columbia Regional Airport (~4 miles away).

No build step, no server-side code, no dependencies — a static page you can
open anywhere. But not a "text on a page" weather app:

## The living sky

The top of the page is a full-bleed scene that mirrors the station's actual
conditions, computed locally:

- **Sky colors follow the real sun elevation** for the station's coordinates
  (NOAA solar-position math in `js/astro.js`) — deep night, twilight, golden
  hour, midday, all blended continuously and dimmed by actual cloud cover.
- **The sun and moon ride their computed arcs**, and the moon renders its
  true phase (correct lit side, waxing/waning).
- **Stars** come out on clear nights; the **cloud deck** scales with the
  reported cloud cover; **rain and snow fall** when the station reports
  precipitation (intensity follows the gauge's rain rate); **lightning**
  flashes during thunderstorms. A little house on the hill turns its
  lights on after sunset.
- Respects `prefers-reduced-motion` — everything renders, nothing animates.

Scene previews for fun: `?wx=storm|rain|snow|clouds|clear` forces a
condition, `?t=22` or `?t=6:30` previews any hour. Both are also in Settings.

## The Rain Ledger

Precipitation is the station's specialty, so it gets a full section:

- **Rain-gauge cylinders** for the month and the year, with the NOAA
  1991–2020 climate normal marked on the glass.
- Stat tiles for today / yesterday / 7-day / 30-day totals with trend
  sparklines, plus a one-line verdict ("11.4″ ahead of normal…").
- A **calendar heatmap of every day of rain this year** (hover any day).
- Daily rainfall bars (30/60/90-day and full-year windows) and the
  **race-against-normal** cumulative chart with a crosshair readout.
- A monthly actual-vs-normal table for the record books.

## Instruments

Sun dial (sunrise/sunset/solar noon/golden hour, live sun position), wind
compass, barometer with 12-hour sparkline and 3-hour trend from KCOU, moon
phase panel (illumination, next full/new), and a dew-point comfort meter.

## Forecast

- A **48-hour meteogram** — temperature curve colored by a labeled
  semantic-heat scale, dew point line, precipitation-chance bars in an
  aligned panel below, night bands shaded, hover crosshair with the full
  hourly readout. Data: the NWS forecast for the station's exact grid point
  (LSX 25,84), not the airport's.
- **Seven days out** as aligned temperature-range bars on a shared scale,
  with precipitation chances; click any day for the full NWS narrative.
- Active watches/warnings appear at the top, severity-coded.

## Station Almanac

The station's own history, told as stories: records for the year (wettest
day, hottest, coldest, biggest gust, rain days, current dry/wet streak) and
an auto-generated feed of **recent weather that mattered** — big rain days
with their year rank, heat runs, freezes, wind events, and long dry spells.

## Observation Deck

A 14-day station log and the KCOU airport log (the API version of the
forecast.weather.gov "3-Day History" page), plus hidden hourly/monthly
tables under each chart for keyboard/screen-reader access.

---

## Running it

```bash
cd Weather
python3 -m http.server 8080
# open http://localhost:8080
```

Or turn on **GitHub Pages** (repo Settings → Pages → deploy from branch,
root folder) and open it from your phone.

## Getting real rain-gauge data (recommended)

Out of the box everything works keyless: forecasts and the KCOU log come
from the free NWS API, the sky scene from Open-Meteo, and precipitation
history from Open-Meteo's model — a clearly-labeled *estimate*.

To use the real readings from KMOCOLUM262:

1. As the station owner you get a free Weather Underground API key:
   wunderground.com → My Profile → Member Settings →
   [API Keys](https://www.wunderground.com/member/api-keys).
2. Open the dashboard → **⚙ Settings** → paste the key → Save.

The key lives only in your browser's `localStorage`. With it, all rainfall
totals, charts, and history come from your station's own gauge (the badge in
the Rain Ledger says which source is live). History is fetched month-by-month
and cached — past months forever, the current month for 30 minutes — so a
typical day uses a handful of calls against the free tier's 1,500/day.

## Data sources

| Data | Primary | Fallback |
|---|---|---|
| Current conditions | WU PWS `observations/current` | NWS KCOU latest |
| Sky scene (clouds, condition) | Open-Meteo current | — |
| Daily history & precip totals | WU PWS `history/daily` (the gauge) | Open-Meteo archive |
| 48h / 7-day forecast | NWS gridpoint LSX 25,84 | — |
| Alerts | NWS active alerts for the coordinates | — |
| KCOU log & barometer | NWS `stations/KCOU/observations` | — |
| Climate normals | NOAA NCEI 1991–2020 (USW00003945), baked into `js/config.js` | — |
| Sun & moon | computed locally (`js/astro.js`) | — |

## Adapting to another location

Edit `js/config.js`: your PWS id + coordinates, your NWS grid (from
`https://api.weather.gov/points/{lat},{lon}`), a nearby observation station,
and your NOAA normals (`ncei.noaa.gov` normals-monthly-1991-2020 dataset).

## Layout

```
index.html        page shell
css/style.css     the observatory look (dark glass, committed single theme)
js/config.js      station ids, grid, NOAA normals, cadence
js/util.js        dates/units/color ramps/cache helpers
js/astro.js       solar position, sunrise/sunset, moon phase (no API)
js/scene.js       the living sky renderer
js/sources.js     Weather Underground, NWS, Open-Meteo clients
js/charts.js      dependency-free SVG charts + tooltip layer
js/almanac.js     records, streaks, notable-event detection
js/app.js         orchestration
```
