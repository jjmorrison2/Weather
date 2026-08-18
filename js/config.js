// Station and location configuration for the dashboard.
//
// Everything here was resolved for PWS KMOCOLUM262 (Columbia, MO) and the
// nearby NWS station KCOU. To adapt this dashboard to another location:
//   1. Set wuStationId to your PWS id and lat/lon to its coordinates.
//   2. Look up your NWS grid:  https://api.weather.gov/points/{lat},{lon}
//      and copy gridId/gridX/gridY from the response.
//   3. Set nwsStationId to a nearby METAR/ASOS station (see the "stations"
//      link in the same /points response).
const CONFIG = {
  title: 'Columbia, MO Weather',

  // Personal weather station (Weather Underground)
  wuStationId: 'KMOCOLUM262',
  lat: 38.875,
  lon: -92.177,
  timezone: 'America/Chicago',

  // NWS observation station (~4 mi away, Columbia Regional Airport)
  nwsStationId: 'KCOU',

  // NWS forecast grid for the PWS coordinates (office LSX, grid 25,84)
  nwsGridId: 'LSX',
  nwsGridX: 25,
  nwsGridY: 84,

  // Refresh cadence for live data (current conditions, forecast, alerts)
  refreshMinutes: 10,

  // How long cached history for the *current* month stays fresh (minutes).
  // Past months never change and are cached indefinitely.
  historyTtlMinutes: 30,

  // Links shown in the footer
  links: {
    wuDashboard: 'https://www.wunderground.com/dashboard/pws/KMOCOLUM262',
    nwsObHistory: 'https://forecast.weather.gov/data/obhistory/KCOU.html',
    wuApiKeys: 'https://www.wunderground.com/member/api-keys',
  },
};
