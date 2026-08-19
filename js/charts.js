// Dependency-free chart toolkit for the dashboard.
//
// Conventions (per the data-viz method):
//   - precipitation is a single-hue sequential blue; temperature uses the
//     semantic-heat ramp WITH a labeled scale legend; "normal" context lines
//     are de-emphasis gray; status colors appear only on alerts.
//   - marks are thin (bars ≤ 24px, 2px lines), grid/axes are solid hairlines,
//     values/labels always wear ink tokens, never the series color.
//   - every hover value is also reachable without hovering (tables/labels).

// ---------------------------------------------------------------------------
// Tooltip singleton — safe text building (labels go in via textContent).
// ---------------------------------------------------------------------------
const Tip = {
  el: null,

  ensure() {
    if (this.el) return this.el;
    this.el = document.createElement('div');
    this.el.id = 'tip';
    this.el.setAttribute('role', 'tooltip');
    document.body.appendChild(this.el);
    // Delegated hover for simple [data-tip] marks (bars, cells, dots).
    document.addEventListener('pointermove', (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (t) this.show(t.getAttribute('data-tip'), e.clientX, e.clientY);
      else if (!this.pinned) this.hide();
    }, { passive: true });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest?.('[data-tip]')) this.hide();
    });
    return this.el;
  },

  // text: lines separated by \n; "k: v" pairs get value emphasis; a line
  // starting with "#hex " gets a color key chip.
  show(text, x, y) {
    const el = this.ensure();
    el.textContent = '';
    String(text).split('\n').forEach((line) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const m = line.match(/^(#[0-9a-fA-F]{6})\s+(.*)$/);
      if (m) {
        const key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = m[1];
        row.appendChild(key);
        line = m[2];
      }
      const ci = line.indexOf(': ');
      if (ci > 0) {
        const lab = document.createElement('span');
        lab.className = 'tip-label';
        lab.textContent = line.slice(0, ci + 2);
        const val = document.createElement('span');
        val.className = 'tip-value';
        val.textContent = line.slice(ci + 2);
        row.append(lab, val);
      } else {
        const strong = document.createElement('span');
        strong.className = 'tip-title';
        strong.textContent = line;
        row.appendChild(strong);
      }
      el.appendChild(row);
    });
    el.style.opacity = '1';
    const pad = 14;
    const r = el.getBoundingClientRect();
    let left = x + pad, top = y + pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  },

  hide() {
    if (this.el) this.el.style.opacity = '0';
  },
};

// ---------------------------------------------------------------------------
const Charts = {
  INK: '#eef4fa',
  INK2: '#a9b7c6',
  MUTED: '#7b8a99',
  GRID: 'rgba(255,255,255,0.07)',
  AXIS: 'rgba(255,255,255,0.16)',
  BLUE: '#3987e5',
  BLUE_SOFT: 'rgba(57,135,229,0.14)',
  GRAY_SERIES: '#8fa0b2',

  niceMax(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      if (m * pow >= v) return m * pow;
    }
    return 10 * pow;
  },

  gridlines(x0, x1, yOf, yMax, fmt, ticks = 4) {
    let out = '';
    for (let i = 0; i <= ticks; i++) {
      const v = (yMax * i) / ticks;
      const y = yOf(v);
      out += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${this.GRID}" stroke-width="1"/>`
        + `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" class="axis-txt">${fmt(v)}</text>`;
    }
    return out;
  },

  // ---- temperature scale legend (semantic heat) ---------------------------
  tempLegend(id = 'tl') {
    const stops = Util.TEMP_ANCHORS.map(([v, c]) =>
      `<stop offset="${((v + 10) / 115) * 100}%" stop-color="${c}"/>`).join('');
    const ticks = [10, 32, 50, 70, 90].map((v) => {
      const x = ((v + 10) / 115) * 160;
      return `<line x1="${x}" y1="10" x2="${x}" y2="14" stroke="${this.MUTED}"/>`
        + `<text x="${x}" y="24" text-anchor="middle" class="axis-txt">${v}°</text>`;
    }).join('');
    return `<svg width="170" height="27" viewBox="0 0 170 27" class="temp-legend" aria-label="temperature color scale">
      <defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs>
      <rect x="0" y="4" width="160" height="6" rx="3" fill="url(#${id})"/>${ticks}</svg>`;
  },

  // ---- daily precipitation bars -------------------------------------------
  precipBars(rows) {
    const W = 960, H = 236, P = { t: 18, r: 14, b: 26, l: 46 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = this.niceMax(Math.max(0.25, ...rows.map((r) => r.precip ?? 0)));
    const yOf = (v) => P.t + ih - (v / max) * ih;
    const bw = iw / rows.length;
    const barW = Math.min(24, bw * 0.68);
    const maxIdx = rows.reduce((mi, r, i) => ((r.precip ?? 0) > (rows[mi].precip ?? 0) ? i : mi), 0);

    let bars = '';
    rows.forEach((r, i) => {
      const v = r.precip ?? 0;
      const x = P.l + bw * i + (bw - barW) / 2;
      const h = (v / max) * ih;
      const tip = `${Util.weekdayDate(r.date)}\nRain: ${r.precip == null ? 'no data' : Util.fmtIn(r.precip)}`;
      bars += `<g data-tip="${Util.esc(tip)}">
        <rect x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
        <rect class="bar-precip" x="${x}" y="${yOf(v)}" width="${barW}" height="${Math.max(h, v > 0 ? 2 : 0)}"
          rx="${Math.min(3, barW / 3)}" fill="${Util.precipColor(Math.max(v, 0.12))}"/>
      </g>`;
      if (i === maxIdx && v > 0) {
        bars += `<text x="${P.l + bw * i + bw / 2}" y="${yOf(v) - 6}" text-anchor="middle" class="direct-label">${Util.fmtIn(v)}</text>`;
      }
    });

    const step = Math.max(1, Math.round(rows.length / 8));
    let xAxis = '';
    for (let i = 0; i < rows.length; i += step) {
      xAxis += `<text x="${P.l + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis-txt">${Util.shortDate(rows[i].date)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="daily rainfall">
      ${this.gridlines(P.l, W - P.r, yOf, max, (v) => v.toFixed(2) + '″')}${bars}${xAxis}</svg>`;
  },

  // ---- cumulative actual vs normal ------------------------------------------
  cumulative(rows, container) {
    const W = 960, H = 250, P = { t: 20, r: 118, b: 26, l: 46 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    let run = 0;
    const pts = rows.map((r) => ({ date: r.date, actual: (run += r.precip ?? 0), normal: Util.normalToDate(r.date) }));
    const last = pts[pts.length - 1];
    const max = this.niceMax(Math.max(last.actual, last.normal, 1));
    const xOf = (i) => P.l + (iw * i) / Math.max(1, pts.length - 1);
    const yOf = (v) => P.t + ih - (v / max) * ih;

    const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join('');
    const area = path('actual') + `L${xOf(pts.length - 1)},${yOf(0)}L${xOf(0)},${yOf(0)}Z`;

    const step = Math.max(1, Math.round(pts.length / 7));
    let xAxis = '';
    for (let i = 0; i < pts.length; i += step) {
      xAxis += `<text x="${xOf(i)}" y="${H - 8}" text-anchor="middle" class="axis-txt">${Util.shortDate(pts[i].date)}</text>`;
    }
    const surplus = last.actual - last.normal;

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg crosshair-chart" role="img" aria-label="cumulative rainfall vs normal">
      ${this.gridlines(P.l, W - P.r, yOf, max, (v) => v.toFixed(0) + '″')}
      <path d="${area}" fill="${this.BLUE_SOFT}"/>
      <path d="${path('normal')}" fill="none" stroke="${this.GRAY_SERIES}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>
      <path d="${path('actual')}" fill="none" stroke="${this.BLUE}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${xOf(pts.length - 1)}" cy="${yOf(last.actual)}" r="4.5" fill="${this.BLUE}" stroke="#141c26" stroke-width="2"/>
      <text x="${xOf(pts.length - 1) + 9}" y="${yOf(last.actual) + 4}" class="direct-label">${Util.fmtIn(last.actual, 1)} actual</text>
      <text x="${xOf(pts.length - 1) + 9}" y="${yOf(last.normal) + 4}" class="direct-label muted-label">${Util.fmtIn(last.normal, 1)} normal</text>
      <line class="xhair" x1="-99" y1="${P.t}" x2="-99" y2="${P.t + ih}" stroke="${this.AXIS}" stroke-width="1"/>
      ${xAxis}</svg>`;

    container.innerHTML = svg;
    this.bindCrosshair(container, pts.length, P, W, (i) => {
      const p = pts[i];
      const d = p.actual - p.normal;
      return `${Util.weekdayDate(p.date)}\n${this.BLUE} Actual: ${Util.fmtIn(p.actual, 1)}\n${this.GRAY_SERIES} Normal: ${Util.fmtIn(p.normal, 1)}\n${d >= 0 ? 'Surplus' : 'Deficit'}: ${Util.fmtIn(Math.abs(d), 1)}`;
    });
    return surplus;
  },

  // Shared crosshair binding: nearest-index hairline + tooltip.
  bindCrosshair(container, n, P, W, tipFor) {
    const svg = container.querySelector('svg');
    const line = svg.querySelector('.xhair');
    const iw = W - P.l - P.r;
    svg.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      if (px < P.l - 6 || px > W - P.r + 6) { line.setAttribute('x1', -99); line.setAttribute('x2', -99); Tip.hide(); return; }
      const i = Util.clamp(Math.round(((px - P.l) / iw) * (n - 1)), 0, n - 1);
      const x = P.l + (iw * i) / Math.max(1, n - 1);
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      Tip.show(tipFor(i), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', () => {
      line.setAttribute('x1', -99); line.setAttribute('x2', -99); Tip.hide();
    });
  },

  // ---- calendar heatmap (year of daily precip) --------------------------------
  calendarHeatmap(daily, todayISO) {
    const year = todayISO.slice(0, 4);
    const start = `${year}-01-01`;
    const cell = 13, gap = 3, top = 22, left = 30;
    // Column = week (Sunday-start), row = weekday.
    const startDow = Util.dowISO(start);
    const days = [];
    for (let d = start, i = 0; d <= `${year}-12-31`; d = Util.addDaysISO(d, 1), i++) {
      days.push({ date: d, idx: i + startDow });
    }
    const weeks = Math.ceil((days.length + startDow) / 7);
    const W = left + weeks * (cell + gap) + 8;
    const H = top + 7 * (cell + gap) + 30;

    let cells = '', monthLabels = '', seenMonth = '';
    for (const { date, idx } of days) {
      const col = Math.floor(idx / 7), row = idx % 7;
      const x = left + col * (cell + gap), y = top + row * (cell + gap);
      const rec = daily.get(date);
      const future = date > todayISO;
      const v = rec?.precip;
      const fill = future ? 'transparent' : v == null ? 'rgba(255,255,255,0.04)' : Util.precipColor(v);
      const stroke = future ? 'rgba(255,255,255,0.05)' : 'transparent';
      const tip = future ? `${Util.weekdayDate(date)}` : `${Util.weekdayDate(date)}\nRain: ${v == null ? 'no data' : Util.fmtIn(v)}`;
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="${stroke}"
        data-tip="${Util.esc(tip)}" class="heat-cell${date === todayISO ? ' heat-today' : ''}"/>`;
      const mon = date.slice(5, 7);
      if (mon !== seenMonth && row === 0) {
        seenMonth = mon;
        monthLabels += `<text x="${x}" y="${top - 8}" class="axis-txt">${Util.monthName(Number(mon))}</text>`;
      }
    }
    const dows = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    const dowLabels = dows.map((t, i) => t
      ? `<text x="${left - 6}" y="${top + i * (cell + gap) + cell - 3}" text-anchor="end" class="axis-txt">${t}</text>` : '').join('');

    const legendStops = [0, 0.1, 0.35, 0.75, 1.5, 3];
    const legend = legendStops.map((v, i) =>
      `<rect x="${left + i * 18}" y="${H - 18}" width="14" height="10" rx="2" fill="${Util.precipColor(v)}" data-tip="${v}${i === legendStops.length - 1 ? '″ or more' : '″'}"/>`).join('')
      + `<text x="${left - 6}" y="${H - 9}" text-anchor="end" class="axis-txt">0″</text>`
      + `<text x="${left + legendStops.length * 18 + 4}" y="${H - 9}" class="axis-txt">3″+</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart-svg" role="img" aria-label="daily rainfall calendar">
      ${monthLabels}${dowLabels}${cells}${legend}</svg>`;
  },

  // ---- rain gauge cylinder ------------------------------------------------------
  gauge(value, normal, sublabel) {
    const W = 130, H = 210;
    const x = 38, w = 54, yTop = 18, yBot = 176;
    const innerH = yBot - yTop;
    const scaleMax = this.niceMax(Math.max(value ?? 0, normal ?? 0, 1) * 1.12);
    const yOf = (v) => yBot - (Util.clamp(v, 0, scaleMax) / scaleMax) * innerH;
    const level = yOf(value ?? 0);
    const normY = normal != null ? yOf(normal) : null;

    let ticks = '';
    const stepIn = scaleMax <= 3 ? 0.5 : scaleMax <= 8 ? 1 : scaleMax <= 20 ? 2 : 5;
    for (let v = 0; v <= scaleMax + 1e-9; v += stepIn) {
      const y = yOf(v);
      const major = Math.abs(v % (stepIn * 2)) < 1e-9;
      ticks += `<line x1="${x + w}" y1="${y}" x2="${x + w + (major ? 9 : 5)}" y2="${y}" stroke="${this.MUTED}" stroke-width="1"/>`;
      if (major) ticks += `<text x="${x + w + 12}" y="${y + 3.5}" class="axis-txt">${v}</text>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" class="gauge-svg" role="img" aria-label="${Util.esc(sublabel)} rain gauge">
      <defs><clipPath id="g-${sublabel.replace(/\W/g, '')}"><rect x="${x}" y="${yTop}" width="${w}" height="${innerH}" rx="6"/></clipPath></defs>
      <rect x="${x}" y="${yTop}" width="${w}" height="${innerH}" rx="6" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <g clip-path="url(#g-${sublabel.replace(/\W/g, '')})">
        <rect class="gauge-water" x="${x}" y="${yBot}" width="${w}" height="0" fill="url(#waterGrad)"
              data-final-y="${level}" data-final-h="${yBot - level}"/>
        <ellipse class="gauge-surface" cx="${x + w / 2}" cy="${yBot}" rx="${w / 2}" ry="3.4"
              fill="#7cb8f2" opacity="0.9" data-final-y="${level}"/>
      </g>
      ${ticks}
      ${normY != null ? `
        <line x1="${x - 10}" y1="${normY}" x2="${x + w}" y2="${normY}" stroke="${this.INK2}" stroke-width="1.5" stroke-dasharray="4 3"/>
        <text x="${x - 10}" y="${normY - 5}" class="axis-txt">normal</text>` : ''}
      <text x="${x + w / 2}" y="${H - 14}" text-anchor="middle" class="gauge-value">${Util.fmtIn(value)}</text>
    </svg>`;
  },

  // Kick the water-fill animation after gauges are in the DOM.
  animateGauges(scope = document) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scope.querySelectorAll('.gauge-water').forEach((r) => {
        r.setAttribute('y', r.dataset.finalY);
        r.setAttribute('height', r.dataset.finalH);
      });
      scope.querySelectorAll('.gauge-surface').forEach((e) => e.setAttribute('cy', e.dataset.finalY));
    }));
  },

  // Shared water gradient (inject once per page).
  defs() {
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6fb1f5"/><stop offset="1" stop-color="#1c4a74"/>
      </linearGradient></defs></svg>`;
  },

  // ---- meteogram: 48h, two aligned panels (temp / precip chance) ----------------
  meteogram(periods, container) {
    const n = periods.length;
    const W = 1080, P = { l: 50, r: 20 };
    const iconY = 20, t1 = 40, h1 = 168, gap = 34, t2 = t1 + h1 + gap, h2 = 84, H = t2 + h2 + 30;
    const iw = W - P.l - P.r;
    const xOf = (i) => P.l + (iw * i) / (n - 1);

    const temps = periods.map((p) => p.temperature);
    const dews = periods.map((p) => Util.cToF(p.dewpoint?.value));
    const tMax = Math.max(...temps), tMin = Math.min(...temps.concat(dews.filter((v) => v != null)));
    const tHi = Math.ceil((tMax + 4) / 5) * 5, tLo = Math.floor((tMin - 4) / 5) * 5;
    const yT = (t) => t1 + h1 - ((t - tLo) / (tHi - tLo)) * h1;
    const yP = (v) => t2 + h2 - (v / 100) * h2;

    // Night shading spanning both panels.
    let nights = '';
    {
      const spanStart = new Date(periods[0].startTime).getTime();
      const spanEnd = new Date(periods[n - 1].startTime).getTime();
      const xAt = (ms) => P.l + ((ms - spanStart) / (spanEnd - spanStart)) * iw;
      let cursor = new Date(spanStart - 86400000);
      const bands = [];
      for (let k = 0; k < 4; k++) {
        const st = Astro.sunTimes(cursor);
        const next = Astro.sunTimes(new Date(cursor.getTime() + 86400000));
        if (st && next) bands.push([st.sunset.getTime(), next.sunrise.getTime()]);
        cursor = new Date(cursor.getTime() + 86400000);
      }
      for (const [a, b] of bands) {
        const x0 = Util.clamp(xAt(a), P.l, W - P.r), x1 = Util.clamp(xAt(b), P.l, W - P.r);
        if (x1 - x0 > 1) nights += `<rect x="${x0}" y="${t1 - 14}" width="${x1 - x0}" height="${t2 + h2 - t1 + 14}" fill="rgba(6,10,20,0.34)" rx="4"/>`;
      }
    }

    // Temperature gradient stroke (semantic heat, legend rendered by caller).
    const gradStops = temps.map((t, i) =>
      `<stop offset="${(i / (n - 1)) * 100}%" stop-color="${Util.tempColor(t)}"/>`).join('');
    const tempPath = temps.map((t, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yT(t).toFixed(1)}`).join('');
    const dewPath = dews.map((d, i) => d == null ? '' : `${i && dews[i - 1] != null ? 'L' : 'M'}${xOf(i).toFixed(1)},${yT(d).toFixed(1)}`).join('');

    // Temp grid: clean 10° lines.
    let tGrid = '';
    for (let t = tLo; t <= tHi; t += 10) {
      tGrid += `<line x1="${P.l}" y1="${yT(t)}" x2="${W - P.r}" y2="${yT(t)}" stroke="${this.GRID}"/>`
        + `<text x="${P.l - 8}" y="${yT(t) + 4}" text-anchor="end" class="axis-txt">${t}°</text>`;
    }
    let pGrid = '';
    for (const v of [0, 50, 100]) {
      pGrid += `<line x1="${P.l}" y1="${yP(v)}" x2="${W - P.r}" y2="${yP(v)}" stroke="${this.GRID}"/>`
        + `<text x="${P.l - 8}" y="${yP(v) + 4}" text-anchor="end" class="axis-txt">${v}%</text>`;
    }

    // PoP bars.
    const bw = Math.min(14, (iw / n) * 0.62);
    let pops = '';
    periods.forEach((p, i) => {
      const v = p.probabilityOfPrecipitation?.value ?? 0;
      if (v <= 0) return;
      pops += `<rect x="${xOf(i) - bw / 2}" y="${yP(v)}" width="${bw}" height="${(v / 100) * h2}" rx="2.5" fill="${this.BLUE}" opacity="0.85"/>`;
    });

    // Icons every 4 hours + hour labels every 6.
    let icons = '', xAxis = '';
    periods.forEach((p, i) => {
      if (i % 4 === 0) icons += `<text x="${xOf(i)}" y="${iconY}" text-anchor="middle" font-size="15">${Util.wxIcon(p.shortForecast, p.isDaytime)}</text>`;
      if (i % 6 === 0) {
        xAxis += `<text x="${xOf(i)}" y="${H - 10}" text-anchor="middle" class="axis-txt">${Util.hourLabel(p.startTime)}</text>`
          + (Util.hourAtStation(p.startTime) < 1 || i === 0
            ? `<text x="${xOf(i)}" y="${H + 4}" text-anchor="middle" class="axis-txt">${Util.localTime(p.startTime, { hour: undefined, minute: undefined })}</text>` : '');
      }
    });

    // Direct labels: hottest and coldest hour.
    const hiI = temps.indexOf(tMax), loI = temps.indexOf(Math.min(...temps));
    const extremes = `
      <circle cx="${xOf(hiI)}" cy="${yT(temps[hiI])}" r="4" fill="${Util.tempColor(temps[hiI])}" stroke="#141c26" stroke-width="2"/>
      <text x="${xOf(hiI)}" y="${yT(temps[hiI]) - 9}" text-anchor="middle" class="direct-label">${Math.round(temps[hiI])}°</text>
      <circle cx="${xOf(loI)}" cy="${yT(temps[loI])}" r="4" fill="${Util.tempColor(temps[loI])}" stroke="#141c26" stroke-width="2"/>
      <text x="${xOf(loI)}" y="${yT(temps[loI]) + 18}" text-anchor="middle" class="direct-label">${Math.round(temps[loI])}°</text>`;

    const svg = `<div class="meteogram-scroll"><svg viewBox="0 0 ${W} ${H + 8}" width="${W}" class="chart-svg crosshair-chart" role="img" aria-label="48 hour forecast">
      ${nights}
      <defs><linearGradient id="tempStroke" x1="0" x2="1" y1="0" y2="0">${gradStops}</linearGradient></defs>
      ${tGrid}${pGrid}${icons}
      <path d="${dewPath}" fill="none" stroke="${this.GRAY_SERIES}" stroke-width="1.8" opacity="0.85"/>
      <path d="${tempPath}" fill="none" stroke="url(#tempStroke)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${pops}${extremes}
      <text x="${P.l}" y="${t2 - 10}" class="panel-label">CHANCE OF PRECIPITATION</text>
      <line class="xhair" x1="-99" y1="${t1 - 14}" x2="-99" y2="${t2 + h2}" stroke="${this.AXIS}"/>
      ${xAxis}</svg></div>`;

    container.innerHTML = svg;
    this.bindCrosshair(container, n, P, W, (i) => {
      const p = periods[i];
      const dew = Util.cToF(p.dewpoint?.value);
      return `${Util.localTime(p.startTime)} — ${p.shortForecast}\n`
        + `${Util.tempColor(p.temperature)} Temp: ${Math.round(p.temperature)}°\n`
        + `${this.GRAY_SERIES} Dew point: ${dew == null ? '—' : Math.round(dew) + '°'}\n`
        + `${this.BLUE} Precip chance: ${p.probabilityOfPrecipitation?.value ?? 0}%\n`
        + `Wind: ${p.windDirection || ''} ${p.windSpeed || ''}`;
    });
  },

  // ---- 7-day strip with aligned temperature range bars ----------------------
  weekStrip(periods) {
    // Group NWS periods into calendar days (day + following night).
    const days = [];
    for (const p of periods) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(new Date(p.startTime));
      let d = days.find((x) => x.date === date);
      if (!d) { d = { date, day: null, night: null }; days.push(d); }
      if (p.isDaytime) d.day = p; else d.night = p;
    }
    const week = days.slice(0, 7);
    const los = week.map((d) => d.night?.temperature).filter((v) => v != null);
    const his = week.map((d) => d.day?.temperature).filter((v) => v != null);
    const lo = Math.min(...los, ...his), hi = Math.max(...his, ...los);
    const span = Math.max(1, hi - lo);

    return week.map((d, i) => {
      const main = d.day || d.night;
      const dHi = d.day?.temperature, dLo = d.night?.temperature;
      const pop = Math.max(d.day?.probabilityOfPrecipitation?.value ?? 0, d.night?.probabilityOfPrecipitation?.value ?? 0);
      const left = dLo != null ? ((dLo - lo) / span) * 100 : ((dHi - lo) / span) * 100;
      const right = dHi != null ? ((dHi - lo) / span) * 100 : left;
      const grad = `linear-gradient(90deg, ${Util.tempColor(dLo ?? dHi)}, ${Util.tempColor(dHi ?? dLo)})`;
      const name = i === 0 ? (d.day ? 'Today' : 'Tonight') : Util.weekdayDate(d.date).split(',')[0];
      const detail = [d.day && `${Util.esc(d.day.name)}: ${Util.esc(d.day.detailedForecast)}`,
        d.night && `${Util.esc(d.night.name)}: ${Util.esc(d.night.detailedForecast)}`].filter(Boolean).join('<br><br>');
      return `<div class="wk-row" data-day="${i}" role="button" tabindex="0" aria-expanded="false">
        <div class="wk-name">${name}<span class="wk-date">${Util.shortDate(d.date)}</span></div>
        <div class="wk-icon" title="${Util.esc(main?.shortForecast || '')}">${Util.wxIcon(main?.shortForecast, true)}</div>
        <div class="wk-pop">${pop > 0 ? `<span class="drop">💧</span>${pop}%` : ''}</div>
        <div class="wk-lo">${dLo != null ? Math.round(dLo) + '°' : '—'}</div>
        <div class="wk-track">
          <div class="wk-bar" style="left:${Math.min(left, right)}%; width:${Math.max(3, Math.abs(right - left))}%; background:${grad}"></div>
        </div>
        <div class="wk-hi">${dHi != null ? Math.round(dHi) + '°' : '—'}</div>
        <div class="wk-text">${Util.esc(main?.shortForecast || '')}</div>
        <div class="wk-detail" hidden>${detail}</div>
      </div>`;
    }).join('');
  },

  // ---- instruments -------------------------------------------------------------
  compass(dirDeg, speed, gust) {
    const C = 90, R = 70;
    let ticks = '';
    for (let a = 0; a < 360; a += 22.5) {
      const main = a % 90 === 0;
      const r1 = R - (main ? 10 : 5), rad = (a - 90) * Math.PI / 180;
      ticks += `<line x1="${C + Math.cos(rad) * r1}" y1="${C + Math.sin(rad) * r1}"
        x2="${C + Math.cos(rad) * R}" y2="${C + Math.sin(rad) * R}"
        stroke="${main ? this.INK2 : 'rgba(255,255,255,0.18)'}" stroke-width="${main ? 2 : 1}"/>`;
    }
    const letters = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([t, a]) => {
      const rad = (a - 90) * Math.PI / 180, r = R - 21;
      return `<text x="${C + Math.cos(rad) * r}" y="${C + Math.sin(rad) * r + 4}" text-anchor="middle" class="compass-letter">${t}</text>`;
    }).join('');
    const hasWind = (speed ?? 0) > 0 && dirDeg != null;
    // Arrow flies with the wind (from dirDeg toward dirDeg+180).
    const needle = hasWind ? `
      <g transform="rotate(${dirDeg + 180}, ${C}, ${C})">
        <path d="M${C},${C - R + 13} l7,16 l-7,-5 l-7,5 Z" fill="${this.BLUE}"/>
        <line x1="${C}" y1="${C - R + 26}" x2="${C}" y2="${C + 28}" stroke="${this.BLUE}" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/>
      </g>` : '';
    return `<svg viewBox="0 0 180 180" class="instrument-svg" role="img" aria-label="wind compass">
      <circle cx="${C}" cy="${C}" r="${R}" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.14)"/>
      ${ticks}${letters}${needle}
      <circle cx="${C}" cy="${C}" r="30" fill="#141c26" stroke="rgba(255,255,255,0.12)"/>
      <text x="${C}" y="${C - 2}" text-anchor="middle" class="instrument-big">${hasWind ? Math.round(speed) : '·'}</text>
      <text x="${C}" y="${C + 14}" text-anchor="middle" class="axis-txt">${hasWind ? 'mph ' + Util.compass(dirDeg) : 'calm'}</text>
      ${gust ? `<text x="${C}" y="${C + 52}" text-anchor="middle" class="axis-txt">gusts ${Math.round(gust)} mph</text>` : ''}
    </svg>`;
  },

  sunDial(times, now) {
    const W = 260, H = 150, cx = W / 2, cy = 118, R = 92;
    if (!times) return '';
    const frac = Util.clamp((now - times.sunrise) / (times.sunset - times.sunrise), 0, 1);
    const isDay = now >= times.sunrise && now <= times.sunset;
    const pt = (f) => {
      const a = Math.PI * (1 - f);
      return [cx + Math.cos(a) * R, cy - Math.sin(a) * R];
    };
    const arc = `M${pt(0)[0]},${pt(0)[1]} A${R},${R} 0 0 1 ${pt(1)[0]},${pt(1)[1]}`;
    const [sx, sy] = pt(frac);
    const golden = (f0, f1) => {
      const [a, b] = [pt(f0), pt(f1)];
      return `M${a[0]},${a[1]} A${R},${R} 0 0 1 ${b[0]},${b[1]}`;
    };
    const hm = (d) => Util.clockTime(d);
    const dayLen = `${Math.floor(times.dayLengthMin / 60)}h ${Math.round(times.dayLengthMin % 60)}m`;
    return `<svg viewBox="0 0 ${W} ${H}" class="instrument-svg" role="img" aria-label="sun position">
      <path d="${arc}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
      <path d="${golden(0, 0.09)}" fill="none" stroke="#f2c94c" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
      <path d="${golden(0.91, 1)}" fill="none" stroke="#f2994a" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
      <line x1="14" y1="${cy}" x2="${W - 14}" y2="${cy}" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
      ${isDay
        ? `<circle cx="${sx}" cy="${sy}" r="9" fill="#ffd76a"/><circle cx="${sx}" cy="${sy}" r="14" fill="#ffd76a" opacity="0.25"/>`
        : `<circle cx="${cx}" cy="${cy + 16}" r="7" fill="#aebdcd" opacity="0.8"/>`}
      <text x="16" y="${cy + 18}" class="axis-txt">↑ ${hm(times.sunrise)}</text>
      <text x="${W - 16}" y="${cy + 18}" text-anchor="end" class="axis-txt">↓ ${hm(times.sunset)}</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" class="dial-sub">${dayLen} of daylight</text>
    </svg>`;
  },

  // ---- 30-day high/low range bars (semantic heat, legend supplied by caller) --
  tempRange(rows) {
    const W = 960, H = 240, P = { t: 16, r: 14, b: 26, l: 44 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const his = rows.map((r) => r.tempHigh).filter((v) => v != null);
    const los = rows.map((r) => r.tempLow).filter((v) => v != null);
    if (!his.length) return '<p class="empty-note">No temperature data yet.</p>';
    const hi = Math.ceil((Math.max(...his) + 4) / 10) * 10;
    const lo = Math.floor((Math.min(...los) - 4) / 10) * 10;
    const yOf = (t) => P.t + ih - ((t - lo) / (hi - lo)) * ih;
    const bw = iw / rows.length;
    const barW = Math.min(14, bw * 0.5);

    let grid = '';
    for (let t = lo; t <= hi; t += 10) {
      grid += `<line x1="${P.l}" y1="${yOf(t)}" x2="${W - P.r}" y2="${yOf(t)}" stroke="${this.GRID}"/>`
        + `<text x="${P.l - 8}" y="${yOf(t) + 4}" text-anchor="end" class="axis-txt">${t}°</text>`;
    }
    let bars = '';
    rows.forEach((r, i) => {
      if (r.tempHigh == null || r.tempLow == null) return;
      const x = P.l + bw * i + (bw - barW) / 2;
      const yH = yOf(r.tempHigh), yL = yOf(r.tempLow);
      const gid = `tg${i}`;
      const tip = `${Util.weekdayDate(r.date)}\nHigh: ${Math.round(r.tempHigh)}°\nLow: ${Math.round(r.tempLow)}°`;
      bars += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${Util.tempColor(r.tempHigh)}"/>
          <stop offset="1" stop-color="${Util.tempColor(r.tempLow)}"/>
        </linearGradient></defs>
        <g data-tip="${Util.esc(tip)}">
          <rect x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
          <rect x="${x}" y="${yH}" width="${barW}" height="${Math.max(3, yL - yH)}" rx="${barW / 2}" fill="url(#${gid})"/>
        </g>`;
    });
    const step = Math.max(1, Math.round(rows.length / 7));
    let xAxis = '';
    for (let i = 0; i < rows.length; i += step) {
      xAxis += `<text x="${P.l + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis-txt">${Util.shortDate(rows[i].date)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="daily high and low temperatures">${grid}${bars}${xAxis}</svg>`;
  },

  sparkline(values, w = 200, h = 44, color = this.BLUE) {
    const clean = values.filter((v) => v != null);
    if (clean.length < 2) return '';
    const min = Math.min(...clean), max = Math.max(...clean);
    const span = max - min || 1;
    const xOf = (i) => (i / (values.length - 1)) * (w - 8) + 4;
    const yOf = (v) => h - 6 - ((v - min) / span) * (h - 12);
    let d = '', started = false;
    values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      started = true;
    });
    const lastI = values.length - 1 - [...values].reverse().findIndex((v) => v != null);
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="spark">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${xOf(lastI)}" cy="${yOf(values[lastI])}" r="3.5" fill="${color}" stroke="#141c26" stroke-width="2"/>
    </svg>`;
  },
};
