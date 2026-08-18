// Data-source clients.
//
//  - WU:  Weather Underground PWS API (api.weather.com). Needs a free API key
//         (PWS owners get one at wunderground.com/member/api-keys). This is
//         the *actual rain gauge* on the station, so it's the preferred
//         source for precipitation and daily history.
//  - NWS: api.weather.gov — forecast, hourly forecast, alerts, and the KCOU
//         observation log. Free, no key.
//  - OM:  Open-Meteo — modeled/reanalysis daily history for the station's
//         coordinates. Free, no key. Used as the fallback when no WU key is
//         configured (clearly labeled as an estimate in the UI).

// ---------------------------------------------------------------------------
// Weather Underground PWS
// ---------------------------------------------------------------------------
const WU = {
  base: 'https://api.weather.com/v2/pws',

  key() { return (localStorage.getItem('wx:apikey') || '').trim(); },
  setKey(k) { localStorage.setItem('wx:apikey', (k || '').trim()); },

  station() { return localStorage.getItem('wx:station') || CONFIG.wuStationId; },
  setStation(s) { localStorage.setItem('wx:station', (s || '').trim() || CONFIG.wuStationId); },

  // Latest observation from the PWS (temp, humidity, wind, pressure,
  // today's rain total and current rain rate).
  async current() {
    const url = `${this.base}/observations/current?stationId=${this.station()}` +
      `&format=json&units=e&apiKey=${this.key()}`;
    const data = await Util.fetchJSON(url);
    return data?.observations?.[0] ?? null;
  },

  // Daily summaries for an inclusive date range (max 31 days per request).
  // Returns [{date, precip, tempHigh, tempLow, windAvg, gustHigh, humidityAvg}].
  async historyRange(startISO, endISO) {
    const url = `${this.base}/history/daily?stationId=${this.station()}` +
      `&format=json&units=e&startDate=${startISO.replaceAll('-', '')}` +
      `&endDate=${endISO.replaceAll('-', '')}&apiKey=${this.key()}`;
    const data = await Util.fetchJSON(url);
    return (data?.observations ?? []).map((o) => ({
      date: (o.obsTimeLocal || '').slice(0, 10),
      precip: o.imperial?.precipTotal ?? null,
      tempHigh: o.imperial?.tempHigh ?? null,
      tempLow: o.imperial?.tempLow ?? null,
      windAvg: o.imperial?.windspeedAvg ?? null,
      gustHigh: o.imperial?.windgustHigh ?? null,
      humidityAvg: o.humidityAvg ?? null,
    })).filter((r) => r.date);
  },

  // Full year-to-date of daily records, fetched month-by-month and cached.
  // Past months are immutable and cached forever; the current month uses a
  // short TTL so today's totals stay fresh.
  async historyYearToDate(todayISO) {
    const year = todayISO.slice(0, 4);
    const curMonth = Number(todayISO.slice(5, 7));
    const station = this.station();
    const out = new Map();

    for (let m = 1; m <= curMonth; m++) {
      const mm = String(m).padStart(2, '0');
      const monthKey = `wu:${station}:${year}-${mm}`;
      const isCurrent = m === curMonth;
      const ttl = isCurrent ? CONFIG.historyTtlMinutes : Infinity;

      let rows = Util.cacheGet(monthKey, ttl);
      if (!rows) {
        const start = `${year}-${mm}-01`;
        const lastDay = new Date(Date.UTC(Number(year), m, 0)).getUTCDate();
        const end = isCurrent ? todayISO : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
        rows = await this.historyRange(start, end);
        Util.cacheSet(monthKey, rows);
      }
      rows.forEach((r) => out.set(r.date, { ...r, source: 'wu' }));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// National Weather Service
// ---------------------------------------------------------------------------
const NWS = {
  headers: { Accept: 'application/geo+json' },

  async forecast() {
    const url = `https://api.weather.gov/gridpoints/${CONFIG.nwsGridId}/${CONFIG.nwsGridX},${CONFIG.nwsGridY}/forecast`;
    const data = await Util.fetchJSON(url, { headers: this.headers });
    return data?.properties?.periods ?? [];
  },

  async forecastHourly() {
    const url = `https://api.weather.gov/gridpoints/${CONFIG.nwsGridId}/${CONFIG.nwsGridX},${CONFIG.nwsGridY}/forecast/hourly`;
    const data = await Util.fetchJSON(url, { headers: this.headers });
    return data?.properties?.periods ?? [];
  },

  async alerts() {
    const url = `https://api.weather.gov/alerts/active?point=${CONFIG.lat},${CONFIG.lon}`;
    const data = await Util.fetchJSON(url, { headers: this.headers });
    return data?.features ?? [];
  },

  // Recent observations from KCOU (newest first) — the API version of the
  // forecast.weather.gov "3-Day History" page.
  async observations(limit = 36) {
    const url = `https://api.weather.gov/stations/${CONFIG.nwsStationId}/observations?limit=${limit}`;
    const data = await Util.fetchJSON(url, { headers: this.headers });
    return (data?.features ?? []).map((f) => {
      const p = f.properties;
      return {
        time: p.timestamp,
        text: p.textDescription || '',
        temp: Util.nwsValue(p.temperature, 'temp'),
        dewpoint: Util.nwsValue(p.dewpoint, 'temp'),
        humidity: Util.nwsValue(p.relativeHumidity, 'percent'),
        windDir: p.windDirection?.value ?? null,
        windSpeed: Util.nwsValue(p.windSpeed, 'speed'),
        windGust: Util.nwsValue(p.windGust, 'speed'),
        pressure: Util.nwsValue(p.barometricPressure, 'pressure'),
        precip1h: Util.nwsValue(p.precipitationLastHour, 'precip'),
      };
    });
  },

  async latestObservation() {
    const obs = await this.observations(1);
    return obs[0] ?? null;
  },
};

// ---------------------------------------------------------------------------
// Open-Meteo (no-key fallback for daily history)
// ---------------------------------------------------------------------------
const OM = {
  daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max',
  units: `precipitation_unit=inch&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(CONFIG.timezone)}`,

  rowsFrom(data) {
    const d = data?.daily;
    if (!d?.time) return [];
    return d.time.map((date, i) => ({
      date,
      precip: d.precipitation_sum?.[i] ?? null,
      tempHigh: d.temperature_2m_max?.[i] ?? null,
      tempLow: d.temperature_2m_min?.[i] ?? null,
      windAvg: null,
      gustHigh: d.wind_gusts_10m_max?.[i] ?? null,
      humidityAvg: null,
    }));
  },

  // Year-to-date daily records. The archive (reanalysis) covers everything up
  // to a day or two ago; the forecast API's "past_days" fills the recent tail.
  async historyYearToDate(todayISO) {
    const cacheKey = `om:${CONFIG.lat},${CONFIG.lon}:${todayISO.slice(0, 4)}`;
    const cached = Util.cacheGet(cacheKey, CONFIG.historyTtlMinutes);
    if (cached) return new Map(cached.map((r) => [r.date, r]));

    const start = `${todayISO.slice(0, 4)}-01-01`;
    const archiveUrl = 'https://archive-api.open-meteo.com/v1/archive' +
      `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}` +
      `&start_date=${start}&end_date=${todayISO}&daily=${this.daily}&${this.units}`;
    const bridgeUrl = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}` +
      `&past_days=7&forecast_days=1&daily=${this.daily}&${this.units}`;

    const [archive, bridge] = await Promise.all([
      Util.fetchJSON(archiveUrl).catch(() => null),
      Util.fetchJSON(bridgeUrl).catch(() => null),
    ]);

    const out = new Map();
    this.rowsFrom(archive).forEach((r) => {
      if (r.precip != null || r.tempHigh != null) out.set(r.date, { ...r, source: 'om' });
    });
    // Fill any recent days the archive hasn't published yet.
    this.rowsFrom(bridge).forEach((r) => {
      if (r.date <= todayISO && !out.has(r.date) && (r.precip != null || r.tempHigh != null)) {
        out.set(r.date, { ...r, source: 'om' });
      }
    });

    Util.cacheSet(cacheKey, [...out.values()]);
    return out;
  },
};
