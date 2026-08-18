// Dashboard orchestration and rendering.

const App = {
  daily: null,        // Map(date -> daily record), year to date
  dailySource: null,  // 'wu' | 'om'
  chartWindow: 30,    // days shown in the daily precip chart

  async init() {
    document.title = CONFIG.title;
    Util.el('page-title').textContent = CONFIG.title;
    Util.el('station-badge').textContent = WU.station();
    this.wireSettings();
    this.wireChartButtons();
    this.refreshAll();
    setInterval(() => this.refreshLive(), CONFIG.refreshMinutes * 60 * 1000);
  },

  refreshAll() {
    Util.el('updated').textContent = 'Updating…';
    const jobs = [
      this.loadAlerts(),
      this.loadCurrent(),
      this.loadHistory(),
      this.loadForecast(),
      this.loadHourly(),
      this.loadObsLog(),
    ];
    Promise.allSettled(jobs).then(() => {
      Util.el('updated').textContent = 'Updated ' + Util.localTime(Date.now());
    });
  },

  // Live data only (history is TTL-cached and refreshes itself when stale).
  refreshLive() {
    Promise.allSettled([
      this.loadAlerts(),
      this.loadCurrent(),
      this.loadHistory(),
      this.loadObsLog(),
    ]).then(() => {
      Util.el('updated').textContent = 'Updated ' + Util.localTime(Date.now());
    });
  },

  fail(id, msg) {
    Util.el(id).innerHTML = `<div class="error">⚠️ ${Util.esc(msg)}</div>`;
  },

  // ---- alerts ---------------------------------------------------------------

  async loadAlerts() {
    const box = Util.el('alerts');
    try {
      const alerts = await NWS.alerts();
      if (!alerts.length) { box.innerHTML = ''; box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = alerts.map((a) => {
        const p = a.properties;
        const sev = (p.severity || 'Unknown').toLowerCase();
        return `<details class="alert sev-${sev}">
          <summary><span class="alert-icon">⚠️</span> <strong>${Util.esc(p.event)}</strong>
            <span class="muted">until ${p.ends ? Util.localTime(p.ends) : '—'}</span></summary>
          <p class="alert-headline">${Util.esc(p.headline || '')}</p>
          <pre class="alert-body">${Util.esc(p.description || '')}</pre>
        </details>`;
      }).join('');
    } catch (e) {
      box.hidden = false;
      this.fail('alerts', 'Could not load alerts: ' + e.message);
    }
  },

  // ---- current conditions ----------------------------------------------------

  async loadCurrent() {
    const box = Util.el('current');
    try {
      if (WU.key()) {
        const o = await WU.current();
        if (o) return this.renderCurrentWU(o);
      }
      const o = await NWS.latestObservation();
      if (o) return this.renderCurrentNWS(o);
      this.fail('current', 'No current observation available.');
    } catch (e) {
      // A bad WU key shouldn't blank the panel — fall back to KCOU.
      try {
        const o = await NWS.latestObservation();
        if (o) {
          this.renderCurrentNWS(o);
          this.note('current-note', `Weather Underground request failed (${e.message}) — showing ${CONFIG.nwsStationId} instead. Check your API key in Settings.`);
          return;
        }
      } catch { /* fall through */ }
      this.fail('current', 'Could not load current conditions: ' + e.message);
    }
  },

  note(id, msg) {
    const el = Util.el(id);
    if (el) { el.hidden = false; el.textContent = msg; }
  },

  currentHTML({ temp, feels, icon, text, stats, sourceLabel, time }) {
    return `
      <div class="current-main">
        <div class="current-icon">${icon}</div>
        <div>
          <div class="current-temp">${Util.fmt(temp, 0, '°F')}</div>
          <div class="current-text">${Util.esc(text)}</div>
          <div class="muted">Feels like ${Util.fmt(feels, 0, '°')} · ${sourceLabel} · ${time}</div>
        </div>
      </div>
      <div class="stat-grid">
        ${stats.map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('')}
      </div>`;
  },

  renderCurrentWU(o) {
    const i = o.imperial || {};
    const feels = (i.temp != null && i.temp >= 70) ? i.heatIndex : i.windChill;
    const raining = (i.precipRate ?? 0) > 0;
    const hour = Util.hourAtStation(o.obsTimeUtc || Date.now());
    const isDay = hour >= 6 && hour < 20;
    const icon = raining ? '🌧️' : !isDay ? '🌙' : (o.solarRadiation ?? 0) > 200 ? '☀️' : '⛅';
    Util.el('current').innerHTML = this.currentHTML({
      temp: i.temp,
      feels,
      icon,
      text: raining ? `Raining — ${Util.fmtIn(i.precipRate)}/hr` : 'Station observation',
      time: Util.localTime(o.obsTimeUtc),
      sourceLabel: `PWS ${Util.esc(o.stationID)}`,
      stats: [
        ['Rain today', Util.fmtIn(i.precipTotal)],
        ['Rain rate', Util.fmtIn(i.precipRate) + '/hr'],
        ['Humidity', Util.fmt(o.humidity, 0, '%')],
        ['Dew point', Util.fmt(i.dewpt, 0, '°')],
        ['Wind', (i.windSpeed ?? 0) > 0 ? `${Util.compass(o.winddir)} ${Util.fmt(i.windSpeed, 0, ' mph')}` : 'Calm'],
        ['Gust', Util.fmt(i.windGust, 0, ' mph')],
        ['Pressure', Util.fmt(i.pressure, 2, ' inHg')],
        ['UV / Solar', `${Util.fmt(o.uv, 0)} / ${Util.fmt(o.solarRadiation, 0, ' W/m²')}`],
      ],
    });
  },

  renderCurrentNWS(o) {
    Util.el('current').innerHTML = this.currentHTML({
      temp: o.temp,
      feels: o.temp,
      icon: Util.wxIcon(o.text, new Date(o.time).getHours() >= 6 && new Date(o.time).getHours() < 20),
      text: o.text || 'Observation',
      time: Util.localTime(o.time),
      sourceLabel: `NWS ${CONFIG.nwsStationId} (~4 mi away)`,
      stats: [
        ['Humidity', Util.fmt(o.humidity, 0, '%')],
        ['Dew point', Util.fmt(o.dewpoint, 0, '°')],
        ['Wind', `${Util.compass(o.windDir)} ${Util.fmt(o.windSpeed, 0, ' mph')}`],
        ['Gust', Util.fmt(o.windGust, 0, ' mph')],
        ['Pressure', Util.fmt(o.pressure, 2, ' inHg')],
        ['Precip (last hr)', Util.fmtIn(o.precip1h)],
      ],
    });
  },

  // ---- precipitation & daily history -----------------------------------------

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

      // If the PWS is live, prefer its real-time gauge reading for today.
      if (this.dailySource === 'wu' && WU.key()) {
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

      this.renderPrecipCards(today);
      this.renderPrecipCharts(today);
      this.renderDailyTable(today);
      this.renderSourceBadge();
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

  renderPrecipCards(today) {
    const y = today.slice(0, 4);
    const ranges = [
      ['Today', this.daily.get(today)?.precip ?? 0],
      ['Yesterday', this.daily.get(Util.addDaysISO(today, -1))?.precip],
      ['Last 7 days', this.sumRange(Util.addDaysISO(today, -6), today)],
      ['Last 30 days', this.sumRange(Util.addDaysISO(today, -29), today)],
      ['Month to date', this.sumRange(today.slice(0, 8) + '01', today)],
      ['Year to date', this.sumRange(`${y}-01-01`, today)],
    ];
    Util.el('precip-cards').innerHTML = ranges.map(([label, v]) => `
      <div class="card precip-card">
        <div class="precip-value">${Util.fmtIn(v)}</div>
        <div class="precip-label">${label}</div>
      </div>`).join('');
  },

  rowsForWindow(today, days) {
    const start = days === 'ytd' ? today.slice(0, 4) + '-01-01' : Util.addDaysISO(today, -(days - 1));
    const rows = [];
    for (let d = start; d <= today; d = Util.addDaysISO(d, 1)) {
      rows.push(this.daily.get(d) || { date: d, precip: null, tempHigh: null, tempLow: null });
    }
    return rows;
  },

  renderPrecipCharts(today) {
    const rows = this.rowsForWindow(today, this.chartWindow === 'ytd' ? 'ytd' : this.chartWindow);
    Util.el('precip-chart').innerHTML = Charts.precipBars(rows);
    Util.el('cumulative-chart').innerHTML = Charts.cumulative(this.rowsForWindow(today, 'ytd'));
    Util.el('temp-chart').innerHTML = Charts.tempRange(this.rowsForWindow(today, 30));
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
          ${rows.map((r) => `<tr${r.date === today ? ' class="today-row"' : ''}>
            <td>${Util.weekdayDate(r.date)}${r.date === today ? ' <span class="pill">today</span>' : ''}</td>
            <td>${Util.fmt(r.tempHigh, 0, '°')}</td>
            <td>${Util.fmt(r.tempLow, 0, '°')}</td>
            <td class="${(r.precip ?? 0) > 0 ? 'has-rain' : ''}">${Util.fmtIn(r.precip)}</td>
            <td>${Util.fmt(r.windAvg, 0, ' mph')}</td>
            <td>${Util.fmt(r.gustHigh, 0, ' mph')}</td>
            ${showHum ? `<td>${Util.fmt(r.humidityAvg, 0, '%')}</td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>`;
  },

  renderSourceBadge() {
    const wu = this.dailySource === 'wu';
    const badge = Util.el('precip-source');
    badge.textContent = wu
      ? `📡 From your rain gauge (${WU.station()})`
      : '🛰️ Modeled estimate (Open-Meteo) — add your free Weather Underground API key in Settings to use your station’s actual gauge';
    badge.className = 'source-badge ' + (wu ? 'source-gauge' : 'source-model');
  },

  // ---- forecast ----------------------------------------------------------------

  async loadForecast() {
    try {
      const periods = await NWS.forecast();
      Util.el('forecast').innerHTML = periods.slice(0, 14).map((p) => {
        const pop = p.probabilityOfPrecipitation?.value;
        return `<div class="card fc-card${p.isDaytime ? '' : ' fc-night'}" title="${Util.esc(p.detailedForecast)}">
          <div class="fc-name">${Util.esc(p.name)}</div>
          <div class="fc-icon">${Util.wxIcon(p.shortForecast, p.isDaytime)}</div>
          <div class="fc-temp">${p.temperature}°<span class="muted">${p.isDaytime ? ' high' : ' low'}</span></div>
          <div class="fc-pop">${pop ? `💧 ${pop}%` : '&nbsp;'}</div>
          <div class="fc-text">${Util.esc(p.shortForecast)}</div>
          <div class="fc-wind muted">${Util.esc(p.windDirection || '')} ${Util.esc(p.windSpeed || '')}</div>
        </div>`;
      }).join('');
    } catch (e) {
      this.fail('forecast', 'Could not load the NWS forecast: ' + e.message);
    }
  },

  async loadHourly() {
    try {
      const periods = (await NWS.forecastHourly()).slice(0, 48);
      Util.el('hourly').innerHTML = periods.map((p, idx) => {
        const pop = p.probabilityOfPrecipitation?.value ?? 0;
        const isNewDay = Util.hourAtStation(p.startTime) === 0;
        return `<div class="hour${isNewDay ? ' hour-newday' : ''}" title="${Util.esc(p.shortForecast)} — wind ${Util.esc(p.windDirection || '')} ${Util.esc(p.windSpeed || '')}">
          <div class="hour-time">${Util.hourLabel(p.startTime)}</div>
          <div class="hour-day muted">${isNewDay || idx === 0 ? Util.localTime(p.startTime, { hour: undefined, minute: undefined }) : ''}</div>
          <div class="hour-icon">${Util.wxIcon(p.shortForecast, p.isDaytime)}</div>
          <div class="hour-temp">${p.temperature}°</div>
          <div class="hour-pop" style="--pop:${pop}">${pop > 0 ? pop + '%' : ''}</div>
        </div>`;
      }).join('');
    } catch (e) {
      this.fail('hourly', 'Could not load the hourly forecast: ' + e.message);
    }
  },

  // ---- KCOU observation log ------------------------------------------------------

  async loadObsLog() {
    try {
      const obs = await NWS.observations(36);
      Util.el('obs-table').innerHTML = `
        <table>
          <thead><tr>
            <th>Time</th><th>Weather</th><th>Temp</th><th>Dew pt</th>
            <th>Humidity</th><th>Wind</th><th>Pressure</th><th>Precip 1 hr</th>
          </tr></thead>
          <tbody>
            ${obs.map((o) => `<tr>
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
    }
  },

  // ---- UI wiring --------------------------------------------------------------------

  wireChartButtons() {
    document.querySelectorAll('#chart-windows button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#chart-windows button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.chartWindow = btn.dataset.window === 'ytd' ? 'ytd' : Number(btn.dataset.window);
        if (this.daily) this.renderPrecipCharts(Util.todayISO());
      });
    });
  },

  wireSettings() {
    const dlg = Util.el('settings-dialog');
    Util.el('settings-btn').addEventListener('click', () => {
      Util.el('setting-apikey').value = WU.key();
      Util.el('setting-station').value = WU.station();
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
          status.textContent = `✗ Key test failed (${e.message}). Saved anyway — the dashboard will fall back to modeled data if it keeps failing.`;
        }
      } else {
        WU.setKey('');
        status.textContent = 'Key removed — using Open-Meteo modeled estimates for history.';
      }
      Util.cacheClear();
      Util.el('station-badge').textContent = WU.station();
      setTimeout(() => { dlg.close(); this.refreshAll(); }, 1200);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
