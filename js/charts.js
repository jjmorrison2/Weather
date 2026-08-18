// Dependency-free SVG charts: precipitation bars, a cumulative area chart,
// and a high/low temperature range chart. Each returns an SVG string sized
// with a viewBox so it scales responsively.

const Charts = {
  W: 860,
  H: 240,
  PAD: { top: 14, right: 12, bottom: 26, left: 44 },

  // Round a max value up to a "nice" axis ceiling.
  niceMax(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      if (m * pow >= v) return m * pow;
    }
    return 10 * pow;
  },

  frame(yMax, yFmt, innerContent, xLabels) {
    const { W, H, PAD } = this;
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const y = PAD.top + ih - (ih * i) / ticks;
      const val = (yMax * i) / ticks;
      grid += `<line class="grid" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>` +
        `<text class="tick" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${yFmt(val)}</text>`;
    }
    let xAxis = '';
    for (const { x, label } of xLabels) {
      xAxis += `<text class="tick" x="${x}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">` +
      grid + innerContent + xAxis + '</svg>';
  },

  // Evenly-spaced x labels: roughly `count` of them across the data.
  xLabelsFor(rows, xOf, count = 8) {
    const labels = [];
    if (!rows.length) return labels;
    const step = Math.max(1, Math.round(rows.length / count));
    for (let i = 0; i < rows.length; i += step) {
      labels.push({ x: xOf(i), label: Util.shortDate(rows[i].date) });
    }
    return labels;
  },

  // Daily precipitation bars. rows: [{date, precip}]
  precipBars(rows) {
    const { W, H, PAD } = this;
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const max = this.niceMax(Math.max(0.25, ...rows.map((r) => r.precip ?? 0)));
    const bw = iw / rows.length;
    const xOf = (i) => PAD.left + bw * i + bw / 2;

    let bars = '';
    rows.forEach((r, i) => {
      const v = r.precip ?? 0;
      const h = (v / max) * ih;
      const x = PAD.left + bw * i;
      const title = `${Util.weekdayDate(r.date)}: ${r.precip == null ? 'no data' : Util.fmtIn(r.precip)}`;
      bars += `<g><title>${title}</title>` +
        `<rect class="hover-target" x="${x}" y="${PAD.top}" width="${bw}" height="${ih}"/>` +
        `<rect class="bar${r.precip == null ? ' nodata' : ''}" x="${x + bw * 0.15}" ` +
        `y="${PAD.top + ih - h}" width="${bw * 0.7}" height="${Math.max(h, v > 0 ? 2 : 0)}" rx="1"/></g>`;
    });
    return this.frame(max, (v) => v.toFixed(2) + '"', bars, this.xLabelsFor(rows, xOf));
  },

  // Cumulative precipitation area chart. rows: [{date, precip}] in date order.
  cumulative(rows) {
    const { W, H, PAD } = this;
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    let running = 0;
    const pts = rows.map((r, i) => {
      running += r.precip ?? 0;
      return { date: r.date, total: running, i };
    });
    const max = this.niceMax(Math.max(1, running));
    const xOf = (i) => PAD.left + (iw * i) / Math.max(1, rows.length - 1);
    const yOf = (v) => PAD.top + ih - (v / max) * ih;

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.i).toFixed(1)},${yOf(p.total).toFixed(1)}`).join('');
    const area = line + `L${xOf(pts.length - 1).toFixed(1)},${yOf(0)}L${xOf(0).toFixed(1)},${yOf(0)}Z`;

    // Sparse hover targets: one slice per point.
    let hovers = '';
    const sw = iw / Math.max(1, pts.length);
    pts.forEach((p) => {
      hovers += `<g><title>${Util.weekdayDate(p.date)}: ${Util.fmtIn(p.total)} YTD</title>` +
        `<rect class="hover-target" x="${(xOf(p.i) - sw / 2).toFixed(1)}" y="${PAD.top}" width="${sw.toFixed(1)}" height="${ih}"/></g>`;
    });

    const content = `<path class="area" d="${area}"/><path class="line" d="${line}"/>` + hovers;
    return this.frame(max, (v) => v.toFixed(1) + '"', content, this.xLabelsFor(rows, xOf));
  },

  // High/low temperature range chart. rows: [{date, tempHigh, tempLow}]
  tempRange(rows) {
    const { W, H, PAD } = this;
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const highs = rows.map((r) => r.tempHigh).filter((v) => v != null);
    const lows = rows.map((r) => r.tempLow).filter((v) => v != null);
    if (!highs.length) return '<p class="muted">No temperature data available.</p>';
    const hi = Math.ceil((Math.max(...highs) + 5) / 10) * 10;
    const lo = Math.floor((Math.min(...lows) - 5) / 10) * 10;
    const bw = iw / rows.length;
    const xOf = (i) => PAD.left + bw * i + bw / 2;
    const yOf = (t) => PAD.top + ih - ((t - lo) / (hi - lo)) * ih;

    let bars = '';
    rows.forEach((r, i) => {
      if (r.tempHigh == null || r.tempLow == null) return;
      const x = PAD.left + bw * i;
      const yH = yOf(r.tempHigh);
      const yL = yOf(r.tempLow);
      bars += `<g><title>${Util.weekdayDate(r.date)}: ${Math.round(r.tempHigh)}° / ${Math.round(r.tempLow)}°</title>` +
        `<rect class="hover-target" x="${x}" y="${PAD.top}" width="${bw}" height="${ih}"/>` +
        `<rect class="temp-bar" x="${x + bw * 0.28}" y="${yH}" width="${bw * 0.44}" height="${Math.max(2, yL - yH)}" rx="3"/></g>`;
    });

    // Manual frame so the y axis spans lo..hi instead of 0..max.
    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const t = lo + ((hi - lo) * i) / ticks;
      const y = yOf(t);
      grid += `<line class="grid" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>` +
        `<text class="tick" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${Math.round(t)}°</text>`;
    }
    let xAxis = '';
    for (const { x, label } of this.xLabelsFor(rows, xOf)) {
      xAxis += `<text class="tick" x="${x}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${grid}${bars}${xAxis}</svg>`;
  },
};
