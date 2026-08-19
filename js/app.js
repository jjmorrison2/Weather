// Dashboard orchestration: fetch → compute → render each section.

const App = {
  daily: null,          // Map(date -> daily record), year to date
  dailySource: null,    // 'wu' | 'om'
  chartWindow: 30,
  sceneInputs: null,
  timeOffsetMs: 0,      // ?t= debug override
  wxOverride: null,     // ?wx= / settings scene preview
  heroBits: { live: '', forecast: '' },

  renderHeroSub() {
    Util.el('hero-sub').textContent =
      [this.heroBits.live, this.heroBits.forecast].filter(Boolean).join(' · ');
  },

  // The clock the scene & hero run on (real time unless ?t= is set).
  now() { return new Date(Date.now() + this.timeOffsetMs); },

  async init() {
    this.parseDebugParams();
    Scene.init(Util.el('scene'));
    document.body.insertAdjacentHTML('beforeend', Charts.defs());
    Tip.ensure();
    Util.el('station-badge').textContent = WU.station();
    Util.el('meteo-temp-legend').innerHTML = Charts.tempLegend('tlMeteo');
    Util.el('temp30-legend').innerHTML = Charts.tempLegend('tl30');

    this.wireSettings();
    this.wireChartButtons();
    this.wireTabs();
    this.startClock();
    this.refreshAll();

    setInterval(() => this.refreshLive(), CONFIG.refreshMinutes * 60 * 1000);
    // Re-aim the sun/moon and sky colors every minute.
    setInterval(() => { if (this.sceneInputs) Scene.update({ ...this.sceneInputs, now: this.now() }); }, 60000);
  },

  parseDebugParams() {
    const q = new URLSearchParams(location.search);
    const t = q.get('t');
    if (t) {
      const target = new Date();
      const [h, m] = t.includes(':') ? t.split(':').map(Number) : [Number(t), 0];
      if (!Number.isNaN(h)) {
        // Interpret as station-local wall clock: shift by the difference from
        // the current station-local hour.
        const nowH = Util.hourAtStation(target);
        this.timeOffsetMs = ((h + (m || 0) / 60) - nowH) * 3600000;
      }
      const iso = Date.parse(t);
      if (!Number.isNaN(iso) && t.length > 8) this.timeOffsetMs = iso - Date.now();
    }
    const wx = q.get('wx');
    if (wx) sessionStorage.setItem('wx:sceneOverride', wx);
    this.wxOverride = sessionStorage.getItem('wx:sceneOverride') || null;
  },

  startClock() {
    const paint = () => {
      Util.el('clock').textContent = this.now().toLocaleString('en-US', {
        timeZone: CONFIG.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit',
      });
    };
    paint();
    setInterval(paint, 1000);
  },

  refreshAll() {
    Util.el('updated').textContent = 'Updating…';
    Promise.allSettled([
      this.loadHero(),
      this.loadAlerts(),
      this.loadHistory(),
      this.loadForecast(),
      this.loadObsLog(),
    ]).then(() => this.stampUpdated());
  },

  refreshLive() {
    Promise.allSettled([
      this.loadHero(),
      this.loadAlerts(),
      this.loadHistory(),
      this.loadObsLog(),
    ]).then(() => this.stampUpdated());
  },

  // loadHero owns the "PWS · observed …" line; only fall back if it never wrote.
  stampUpdated() {
    const u = Util.el('updated');
    if (!u.textContent || u.textContent === 'Updating…') {
      u.textContent = 'Updated ' + Util.localTime(Date.now());
    }
  },

  fail(id, msg) {
    const el = Util.el(id);
    if (el) el.innerHTML = `<div class="error">⚠️ ${Util.esc(msg)}</div>`;
  },

  note(id, msg) {
    const el = Util.el(id);
    if (el) { el.hidden = false; el.textContent = msg; }
  },

  // ================= HERO + LIVING SKY =================

  async loadHero() {
    // Gather in parallel: the PWS (if keyed), the sky state, and NWS backup.
    const [wuCur, omCur, nwsCur] = await Promise.all([
      WU.key() ? WU.current().catch(() => null) : Promise.resolve(null),
      OM.sceneNow().catch(() => null),
      NWS.latestObservation().catch(() => null),
    ]);

    const i = wuCur?.imperial || {};
    const wmo = Util.wmo(omCur?.weather_code);
    const temp = i.temp ?? nwsCur?.temp ?? omCur?.temperature_2m ?? null;
    const humidity = wuCur?.humidity ?? nwsCur?.humidity ?? omCur?.relative_humidity_2m ?? null;
    const dew = i.dewpt ?? nwsCur?.dewpoint ?? null;
    const windMph = i.windSpeed ?? nwsCur?.windSpeed ?? omCur?.wind_speed_10m ?? 0;
    const windDir = wuCur?.winddir ?? nwsCur?.windDir ?? omCur?.wind_direction_10m ?? null;
    const gust = i.windGust ?? nwsCur?.windGust ?? omCur?.wind_gusts_10m ?? null;
    const pressure = i.pressure ?? nwsCur?.pressure ?? null;
    const rainToday = i.precipTotal ?? null;
    const rainRate = i.precipRate ?? (omCur?.precipitation || 0);
    const feels = temp == null ? null : (temp >= 70 ? (i.heatIndex ?? temp) : (i.windChill ?? temp));
    const condText = nwsCur?.text || wmo.label || '';

    // Scene inputs — the PWS gauge wins for "is it raining right now".
    let kind = this.wxOverride || wmo.kind;
    if (!this.wxOverride && rainRate > 0 && kind !== 'snow' && kind !== 'storm') kind = 'rain';
    this.sceneInputs = {
      tempF: temp,
      cloudPct: this.wxOverride
        ? { clear: 8, clouds: 85, rain: 92, storm: 95, snow: 90, fog: 96 }[this.wxOverride] ?? 40
        : omCur?.cloud_cover ?? 35,
      kind,
      precipRate: this.wxOverride === 'rain' ? 0.25 : this.wxOverride === 'storm' ? 0.6 : rainRate,
      windMph, windDirDeg: windDir,
      now: this.now(),
    };
    Scene.update(this.sceneInputs);

    // Hero text.
    Util.el('hero-temp').textContent = temp == null ? '—°' : Math.round(temp) + '°';
    Util.el('hero-text').textContent = condText || '—';
    const sub = [];
    if (feels != null && Math.abs(feels - temp) >= 2) sub.push(`Feels like ${Math.round(feels)}°`);
    if (rainRate > 0) sub.push(`raining at ${Util.fmtIn(rainRate)}/hr`);
    this.heroBits.live = sub.join(' · ');
    this.renderHeroSub();

    const chips = [
      ['Wind', windMph > 0 ? `${Util.compass(windDir)} ${Math.round(windMph)} mph` : 'Calm'],
      ['Gusts', gust ? Math.round(gust) + ' mph' : null],
      ['Humidity', humidity != null ? Math.round(humidity) + '%' : null],
      ['Dew point', dew != null ? Math.round(dew) + '°' : null],
      ['Rain today', rainToday != null ? Util.fmtIn(rainToday) : null],
      ['Pressure', pressure != null ? pressure.toFixed(2) + ' inHg' : null],
      ['UV', wuCur?.uv != null ? String(Math.round(wuCur.uv)) : null],
    ].filter(([, v]) => v != null);
    Util.el('hero-chips').innerHTML = chips.map(([k, v]) =>
      `<div class="chip"><span class="chip-k">${k}</span><span class="chip-v">${Util.esc(v)}</span></div>`).join('');

    const src = wuCur ? `PWS ${Util.esc(wuCur.stationID)}` : nwsCur ? `NWS ${CONFIG.nwsStationId} (4 mi)` : 'model estimate';
    const at = wuCur?.obsTimeUtc || nwsCur?.time;
    Util.el('updated').textContent = `${src}${at ? ' · observed ' + Util.localTime(at) : ''}`;
    if (WU.key() && !wuCur) {
      this.note('current-note', `Weather Underground isn't answering — showing ${CONFIG.nwsStationId} instead. Check your key in Settings.`);
    } else {
      const noteEl = Util.el('current-note');
      noteEl.hidden = true;
    }

    // Instruments that ride on current conditions.
    this.renderSunMoon();
    Util.el('wind-compass').innerHTML = Charts.compass(windDir, windMph, gust);
    this.renderComfort(dew, temp);
  },

  renderSunMoon() {
    const now = this.now();
    const times = Astro.sunTimes(now);
    Util.el('sun-dial').innerHTML = Charts.sunDial(times, now);
    if (times) {
      const golden = new Date(times.sunset.getTime() - 55 * 60000);
      Util.el('sun-extra').innerHTML =
        `<div class="kv"><span>Solar noon</span><b>${Util.clockTime(times.solarNoon)}</b></div>` +
        `<div class="kv"><span>Golden hour</span><b>${Util.clockTime(golden)}</b></div>`;
    }
    const moon = Astro.moon(now);
    Util.el('moon-panel').innerHTML = `
      <div class="moon-wrap">${Scene.moonSVG(moon, 92)}</div>
      <div class="moon-name">${moon.name}</div>
      <div class="kv"><span>Illuminated</span><b>${Math.round(moon.illum * 100)}%</b></div>
      <div class="kv"><span>Next full</span><b>${Util.localTime(moon.nextFull, { hour: undefined, minute: undefined })}</b></div>
      <div class="kv"><span>Next new</span><b>${Util.localTime(moon.nextNew, { hour: undefined, minute: undefined })}</b></div>`;
  },

  renderComfort(dew, temp) {
    const el = Util.el('comfort');
    if (dew == null) { el.innerHTML = '<p class="empty-note">No dew point reading.</p>'; return; }
    const bands = [
      [55, 'Crisp and comfortable'], [60, 'Pleasant'], [65, 'A touch sticky'],
      [70, 'Humid'], [200, 'Oppressive — swamp air'],
    ];
    const label = bands.find(([max]) => dew < max)[1];
    const pos = Util.clamp((dew - 40) / 40, 0, 1) * 100;
    el.innerHTML = `
      <div class="comfort-value">${Math.round(dew)}°<span class="comfort-unit">dew point</span></div>
      <div class="meter"><div class="meter-pin" style="left:${pos}%"></div></div>
      <div class="meter-scale"><span>40°</span><span>60°</span><span>80°</span></div>
      <div class="comfort-label">${label}</div>`;
  },

  // ================= ALERTS =================

  async loadAlerts() {
    const box = Util.el('alerts');
    try {
      const alerts = await NWS.alerts();
      if (!alerts.length) { box.innerHTML = ''; box.hidden = true; return; }
      box.hidden = false;
      const sevClass = (s) => ({ Extreme: 'critical', Severe: 'critical', Moderate: 'serious', Minor: 'warning' }[s] || 'warning');
      box.innerHTML = alerts.map((a) => {
        const p = a.properties;
        return `<details class="alert alert-${sevClass(p.severity)}">
          <summary><span class="alert-badge">${Util.esc(p.severity || 'Alert')}</span>
            <strong>${Util.esc(p.event)}</strong>
            <span class="alert-until">${p.ends ? 'until ' + Util.localTime(p.ends) : ''}</span></summary>
          <p>${Util.esc(p.headline || '')}</p>
          <pre>${Util.esc(p.description || '')}</pre>
        </details>`;
      }).join('');
    } catch (e) {
      box.hidden = false;
      this.fail('alerts', 'Could not load alerts: ' + e.message);
    }
  },

  // ================= RAIN LEDGER + ALMANAC =================

  async loadHistory() {
    const today = Util.todayISO();
    try {
      if (WU.key()) {
        try {
          this.daily = await WU.historyYearToDate(today);
          this.dailySource = 'wu';
        } catch (e) {
          this.daily = await OM.historyYearToDate(today);
          this.dailySource = 'om';
          this.note('precip-note', `Weather Underground history failed (${e.message}) — showing modeled estimates from Open-Meteo instead.`);
        }
      } else {
        this.daily = await OM.historyYearToDate(today);
        this.dailySource = 'om';
      }

      // Live gauge reading wins for today.
      if (this.dailySource === 'wu') {
        try {
          const cur = await WU.current();
          const liveToday = cur?.imperial?.precipTotal;
          if (liveToday != null) {
            const rec = this.daily.get(today) || { date: today, source: 'wu' };
            rec.precip = Math.max(rec.precip ?? 0, liveToday);
            this.daily.set(today, rec);
          }
        } catch { /* non-fatal */ }
      }

      this.renderRainLedger(today);
      this.renderAlmanac(today);
      this.renderDailyTable(today);
    } catch (e) {
      this.fail('precip-cards', 'Could not load precipitation history: ' + e.message);
      this.fail('daily-table', 'Could not load daily history: ' + e.message);
    }
  },

  sumRange(fromISO, toISO) {
    let sum = 0, have = false;
    for (let d = fromISO; d <= toISO; d = Util.addDaysISO(d, 1)) {
      const v = this.daily.get(d)?.precip;
      if (v != null) { sum += v; have = true; }
    }
    return have ? sum : null;
  },

  rowsForWindow(today, days) {
    const start = days === 'ytd' ? today.slice(0, 4) + '-01-01' : Util.addDaysISO(today, -(days - 1));
    const rows = [];
    for (let d = start; d <= today; d = Util.addDaysISO(d, 1)) {
      rows.push(this.daily.get(d) || { date: d, precip: null, tempHigh: null, tempLow: null });
    }
    return rows;
  },

  renderRainLedger(today) {
    const vs = Almanac.vsNormal(this.daily, today);

    // Verdict line.
    const dY = (vs.ytd ?? 0) - vs.ytdNormal;
    const dM = (vs.mtd ?? 0) - vs.mtdNormal;
    const monthName = Util.monthName(Number(today.slice(5, 7)), 'long');
    Util.el('rain-verdict').textContent =
      `${Util.fmtIn(vs.ytd, 1)} so far this year — ${Util.fmtIn(Math.abs(dY), 1)} ${dY >= 0 ? 'ahead of' : 'behind'} normal. ` +
      `${monthName} is running ${Util.fmtIn(Math.abs(dM))} ${dM >= 0 ? 'above' : 'below'} pace.`;

    // Gauges: month-to-date vs the full-month normal; YTD vs normal-to-date.
    const [y, m] = today.split('-').map(Number);
    const monthNormalFull = CONFIG.normals.precip[m - 1];
    Util.el('gauge-month').innerHTML = Charts.gauge(vs.mtd, monthNormalFull, 'month');
    Util.el('gauge-month-note').textContent = `${monthName} normal: ${Util.fmtIn(monthNormalFull)}`;
    Util.el('gauge-year').innerHTML = Charts.gauge(vs.ytd, vs.ytdNormal, 'year');
    Util.el('gauge-year-note').textContent = `normal to date: ${Util.fmtIn(vs.ytdNormal, 1)}`;
    Charts.animateGauges();

    // Stat tiles.
    const last7 = this.rowsForWindow(today, 7).map((r) => r.precip ?? 0);
    const last30 = this.rowsForWindow(today, 30).map((r) => r.precip ?? 0);
    const tiles = [
      ['Today', this.daily.get(today)?.precip ?? 0, null],
      ['Yesterday', this.daily.get(Util.addDaysISO(today, -1))?.precip, null],
      ['Last 7 days', this.sumRange(Util.addDaysISO(today, -6), today), last7],
      ['Last 30 days', this.sumRange(Util.addDaysISO(today, -29), today), last30],
    ];
    Util.el('precip-cards').innerHTML = tiles.map(([label, v, spark]) => `
      <div class="card stat">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${Util.fmtIn(v)}</div>
        ${spark ? `<div class="stat-spark">${Charts.sparkline(spark, 150, 30)}</div>` : '<div class="stat-spark"></div>'}
      </div>`).join('');

    // Source badge.
    const wu = this.dailySource === 'wu';
    const badge = Util.el('precip-source');
    badge.textContent = wu
      ? `📡 your rain gauge (${WU.station()})`
      : '🛰️ modeled estimate — add your free WU key in Settings for real gauge data';
    badge.className = 'source-badge ' + (wu ? 'source-gauge' : 'source-model');

    // Heatmap + charts + monthly table.
    Util.el('heatmap').innerHTML = Charts.calendarHeatmap(this.daily, today);
    this.renderPrecipChart(today);
    Charts.cumulative(this.rowsForWindow(today, 'ytd'), Util.el('cumulative-chart'));
    Util.el('temp-chart').innerHTML = Charts.tempRange(this.rowsForWindow(today, 30));
    this.renderMonthlyTable(today);
  },

  renderPrecipChart(today) {
    const rows = this.rowsForWindow(today, this.chartWindow === 'ytd' ? 'ytd' : this.chartWindow);
    Util.el('precip-chart').innerHTML = Charts.precipBars(rows);
  },

  renderMonthlyTable(today) {
    const [y, curM] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const monthSum = (m) => {
      const mm = String(m).padStart(2, '0');
      return this.sumRange(`${y}-${mm}-01`, `${y}-${mm}-${String(Util.daysInMonth(y, m)).padStart(2, '0')}`);
    };
    let rows = '';
    let totA = 0, totN = 0;
    for (let m = 1; m <= 12; m++) {
      const future = m > curM;
      const a = future ? null : monthSum(m);
      const n = CONFIG.normals.precip[m - 1];
      if (a != null) { totA += a; totN += (m === curM ? Util.normalMonthToDate(today) : n); }
      const d = a == null ? null : a - (m === curM ? Util.normalMonthToDate(today) : n);
      rows += `<tr${m === curM ? ' class="row-current"' : ''}>
        <td>${Util.monthName(m, 'long')}${m === curM ? ' <span class="pill">to date</span>' : ''}</td>
        <td>${a == null ? '—' : Util.fmtIn(a)}</td>
        <td>${Util.fmtIn(n)}</td>
        <td>${d == null ? '—' : (d >= 0 ? '+' : '−') + Util.fmtIn(Math.abs(d))}</td>
      </tr>`;
    }
    Util.el('monthly-table').innerHTML = `
      <table>
        <thead><tr><th>Month</th><th>Actual</th><th>Normal</th><th>Departure</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Year to date</td><td>${Util.fmtIn(totA, 1)}</td><td>${Util.fmtIn(totN, 1)}</td>
          <td>${(totA - totN >= 0 ? '+' : '−') + Util.fmtIn(Math.abs(totA - totN), 1)}</td></tr></tfoot>
      </table>`;
  },

  renderAlmanac(today) {
    const rec = Almanac.records(this.daily, today);
    if (!rec) return;
    const streak = rec.curDry > 0
      ? [`${rec.curDry}-day dry streak`, 'current — longest this year: ' + rec.longestDry]
      : [`${rec.curWet}-day wet streak`, 'rain every day'];
    const tiles = [
      ['Wettest day', Util.fmtIn(rec.wettest?.precip), Util.shortDate(rec.wettest.date), '🌧️'],
      ['Hottest day', Util.fmt(rec.hottest?.tempHigh, 0, '°'), Util.shortDate(rec.hottest.date), '🔥'],
      ['Coldest low', Util.fmt(rec.coldest?.tempLow, 0, '°'), Util.shortDate(rec.coldest.date), '🥶'],
      ['Biggest gust', Util.fmt(rec.windiest?.gustHigh, 0, ' mph'), Util.shortDate(rec.windiest.date), '💨'],
      ['Days with rain', `${rec.rainDays}`, `of ${rec.days} days`, '💧'],
      ['Streak', streak[0], streak[1], rec.curDry > 0 ? '🌵' : '☔'],
    ];
    Util.el('records').innerHTML = tiles.map(([label, v, sub, icon]) => `
      <div class="card stat record-stat">
        <div class="stat-label">${icon} ${label}</div>
        <div class="stat-value stat-value-sm">${v}</div>
        <div class="stat-sub">${sub}</div>
      </div>`).join('');

    const events = Almanac.events(this.daily, today);
    Util.el('events').innerHTML = events.length ? events.map((e) => `
      <li class="event">
        <span class="event-icon">${e.icon}</span>
        <span class="event-body">
          <span class="event-title">${Util.esc(e.title)}</span>
          <span class="event-detail">${Util.esc(e.detail)}</span>
        </span>
        <span class="event-date">${e.date === e.end ? Util.shortDate(e.date) : Util.shortDate(e.date) + '–' + Util.shortDate(e.end)}</span>
      </li>`).join('')
      : '<li class="event"><span class="event-body">A quiet stretch — nothing notable lately.</span></li>';
  },

  renderDailyTable(today) {
    const rows = this.rowsForWindow(today, 14).reverse();
    const showHum = this.dailySource === 'wu';
    Util.el('daily-table').innerHTML = `
      <table>
        <thead><tr>
          <th>Date</th><th>High</th><th>Low</th><th>Precip</th>
          <th>Avg wind</th><th>Max gust</th>${showHum ? '<th>Avg humidity</th>' : ''}
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr${r.date === today ? ' class="row-current"' : ''}>
            <td>${Util.weekdayDate(r.date)}${r.date === today ? ' <span class="pill">today</span>' : ''}</td>
            <td><i class="temp-dot" style="background:${Util.tempColor(r.tempHigh)}"></i>${Util.fmt(r.tempHigh, 0, '°')}</td>
            <td><i class="temp-dot" style="background:${Util.tempColor(r.tempLow)}"></i>${Util.fmt(r.tempLow, 0, '°')}</td>
            <td class="${(r.precip ?? 0) >= 0.01 ? 'has-rain' : ''}">${Util.fmtIn(r.precip)}</td>
            <td>${Util.fmt(r.windAvg, 0, ' mph')}</td>
            <td>${Util.fmt(r.gustHigh, 0, ' mph')}</td>
            ${showHum ? `<td>${Util.fmt(r.humidityAvg, 0, '%')}</td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>`;
  },

  // ================= FORECAST =================

  async loadForecast() {
    try {
      const [periods, hourly] = await Promise.all([NWS.forecast(), NWS.forecastHourly()]);

      // Hero hi/lo from the first day/night pair.
      const dayP = periods.find((p) => p.isDaytime);
      const nightP = periods.find((p) => !p.isDaytime);
      const bits = [];
      if (dayP) bits.push(`High ${dayP.temperature}°`);
      if (nightP) bits.push(`Low ${nightP.temperature}°`);
      this.heroBits.forecast = bits.join(' · ');
      this.renderHeroSub();

      Charts.meteogram(hourly.slice(0, 48), Util.el('meteogram'));
      this.renderHourlyTable(hourly.slice(0, 48));
      Util.el('week-strip').innerHTML = Charts.weekStrip(periods);
      this.wireWeekRows();
    } catch (e) {
      this.fail('meteogram', 'Could not load the NWS forecast: ' + e.message);
      this.fail('week-strip', 'Could not load the NWS forecast: ' + e.message);
    }
  },

  renderHourlyTable(hourly) {
    Util.el('hourly-table').innerHTML = `
      <table>
        <thead><tr><th>Hour</th><th>Forecast</th><th>Temp</th><th>Dew pt</th><th>Precip chance</th><th>Wind</th></tr></thead>
        <tbody>${hourly.map((p) => `<tr>
          <td>${Util.localTime(p.startTime)}</td>
          <td>${Util.esc(p.shortForecast)}</td>
          <td>${p.temperature}°</td>
          <td>${Util.fmt(Util.cToF(p.dewpoint?.value), 0, '°')}</td>
          <td>${p.probabilityOfPrecipitation?.value ?? 0}%</td>
          <td>${Util.esc(p.windDirection || '')} ${Util.esc(p.windSpeed || '')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  },

  wireWeekRows() {
    Util.el('week-strip').querySelectorAll('.wk-row').forEach((row) => {
      const toggle = () => {
        const d = row.querySelector('.wk-detail');
        d.hidden = !d.hidden;
        row.setAttribute('aria-expanded', String(!d.hidden));
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  },

  // ================= KCOU LOG + BAROMETER =================

  async loadObsLog() {
    try {
      const obs = await NWS.observations(120);
      this.renderBarometer(obs);
      const recent = obs.slice(0, 30);
      Util.el('obs-table').innerHTML = `
        <table>
          <thead><tr>
            <th>Time</th><th>Weather</th><th>Temp</th><th>Dew pt</th>
            <th>Humidity</th><th>Wind</th><th>Pressure</th><th>Precip 1 hr</th>
          </tr></thead>
          <tbody>
            ${recent.map((o) => `<tr>
              <td>${Util.localTime(o.time)}</td>
              <td>${Util.esc(o.text) || '—'}</td>
              <td>${Util.fmt(o.temp, 0, '°')}</td>
              <td>${Util.fmt(o.dewpoint, 0, '°')}</td>
              <td>${Util.fmt(o.humidity, 0, '%')}</td>
              <td>${o.windSpeed ? `${Util.compass(o.windDir)} ${Util.fmt(o.windSpeed, 0, ' mph')}${o.windGust ? ` g ${Util.fmt(o.windGust, 0)}` : ''}` : 'Calm'}</td>
              <td>${Util.fmt(o.pressure, 2, '')}</td>
              <td class="${(o.precip1h ?? 0) > 0 ? 'has-rain' : ''}">${o.precip1h != null ? Util.fmtIn(o.precip1h) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (e) {
      this.fail('obs-table', `Could not load ${CONFIG.nwsStationId} observations: ` + e.message);
      this.fail('barometer', 'No pressure data.');
    }
  },

  renderBarometer(obs) {
    const series = obs.filter((o) => o.pressure != null).reverse(); // oldest→newest
    if (!series.length) { Util.el('barometer').innerHTML = '<p class="empty-note">No pressure data.</p>'; return; }
    const nowP = series[series.length - 1].pressure;
    const nowT = new Date(series[series.length - 1].time).getTime();
    const ago3 = series.filter((o) => nowT - new Date(o.time).getTime() >= 3 * 3600000).pop();
    const delta = ago3 ? nowP - ago3.pressure : null;
    const trend = delta == null ? ['→', 'steady']
      : delta > 0.06 ? ['↑', 'rising fast'] : delta > 0.02 ? ['↗', 'rising']
      : delta < -0.06 ? ['↓', 'falling fast'] : delta < -0.02 ? ['↘', 'falling'] : ['→', 'steady'];
    const hours = (nowT - new Date(series[0].time).getTime()) / 3600000;
    Util.el('barometer').innerHTML = `
      <div class="baro-value">${nowP.toFixed(2)}<span class="baro-unit">inHg</span></div>
      <div class="baro-trend">${trend[0]} ${trend[1]}${delta != null ? ` · ${(delta >= 0 ? '+' : '') + delta.toFixed(2)} in 3h` : ''}</div>
      <div class="baro-spark">${Charts.sparkline(series.map((o) => o.pressure), 200, 46, '#8fa0b2')}</div>
      <div class="kv"><span>last ${Math.round(hours)}h at ${CONFIG.nwsStationId}</span><b></b></div>`;
  },

  // ================= UI WIRING =================

  wireChartButtons() {
    document.querySelectorAll('#chart-windows button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#chart-windows button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.chartWindow = btn.dataset.window === 'ytd' ? 'ytd' : Number(btn.dataset.window);
        if (this.daily) this.renderPrecipChart(Util.todayISO());
      });
    });
  },

  wireTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = true; });
        Util.el('tab-' + tab.dataset.tab).hidden = false;
      });
    });
  },

  wireSettings() {
    const dlg = Util.el('settings-dialog');
    Util.el('settings-btn').addEventListener('click', () => {
      Util.el('setting-apikey').value = WU.key();
      Util.el('setting-station').value = WU.station();
      Util.el('setting-scene').value = sessionStorage.getItem('wx:sceneOverride') || '';
      Util.el('settings-status').textContent = '';
      dlg.showModal();
    });
    Util.el('refresh-btn').addEventListener('click', () => this.refreshAll());
    Util.el('settings-cancel').addEventListener('click', () => dlg.close());
    Util.el('settings-clear').addEventListener('click', () => {
      Util.cacheClear();
      Util.el('settings-status').textContent = 'Cached history cleared.';
    });
    Util.el('settings-save').addEventListener('click', async () => {
      const key = Util.el('setting-apikey').value.trim();
      const station = Util.el('setting-station').value.trim() || CONFIG.wuStationId;
      const scenePick = Util.el('setting-scene').value;
      if (scenePick) sessionStorage.setItem('wx:sceneOverride', scenePick);
      else sessionStorage.removeItem('wx:sceneOverride');
      this.wxOverride = scenePick || null;

      const status = Util.el('settings-status');
      WU.setStation(station);
      if (key) {
        status.textContent = 'Testing key…';
        WU.setKey(key);
        try {
          const o = await WU.current();
          status.textContent = o
            ? `✓ Key works — ${station} reporting ${Util.fmt(o.imperial?.temp, 0, '°F')}.`
            : '⚠ Key accepted but the station returned no data.';
        } catch (e) {
          status.textContent = `✗ Key test failed (${e.message}). Saved anyway — the dashboard falls back to modeled data if it keeps failing.`;
        }
      } else {
        WU.setKey('');
        status.textContent = 'No key — using modeled estimates for history.';
      }
      Util.cacheClear();
      Util.el('station-badge').textContent = WU.station();
      setTimeout(() => { dlg.close(); this.refreshAll(); }, 1100);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
