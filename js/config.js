// Station and location configuration for the dashboard.
//
// Everything here was resolved for PWS KMOCOLUM262 (Columbia, MO) and the
// nearby NWS station KCOU. To adapt this dashboard to another location:
//   1. Set wuStationId to your PWS id and lat/lon to its coordinates.
//   2. Look up your NWS grid:  https://api.weather.gov/points/{lat},{lon}
//      and copy gridId/gridX/gridY from the response.
//   3. Set nwsStationId to a nearby METAR/ASOS station (see the "stations"
//      link in the same /points response).
//   4. Replace the climate normals with your station's (see below).
const CONFIG = {
  title: 'Columbia Sky',
  locationName: 'Columbia, Missouri',

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

  // NOAA 1991-2020 climate normals for Columbia Regional Airport
  // (station USW00003945, via ncei.noaa.gov normals-monthly-1991-2020).
  // Monthly values Jan..Dec; precip in inches, temps in °F.
  normals: {
    precip: [2.12, 2.12, 2.97, 4.88, 4.77, 4.23, 4.13, 4.14, 3.83, 3.47, 2.68, 2.09],
    tmax: [39.5, 45.1, 56.3, 67.2, 75.9, 84.5, 88.5, 87.7, 80.1, 68.2, 54.7, 43.6],
    tmin: [22.5, 26.4, 35.6, 45.6, 55.7, 64.7, 68.5, 66.7, 58.3, 46.8, 36.0, 26.7],
  },

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
