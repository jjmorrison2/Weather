// Small shared helpers: dates (in the station's timezone), unit conversion,
// formatting, color scales, localStorage caching, and DOM shortcuts.

const Util = {
  // ---- dates -------------------------------------------------------------

  // Today's calendar date (YYYY-MM-DD) in the station's timezone, regardless
  // of the viewer's timezone.
  todayISO(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CONFIG.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  },

  // Add days to a YYYY-MM-DD string (pure calendar math, timezone-safe).
  addDaysISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
  },

  daysInMonth(year, month1to12) {
    return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  },

  // Day-of-week for an ISO date, 0 = Sunday (timezone-safe).
  dowISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  },

  // "2026-08-16" -> "Aug 16"
  shortDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  },

  // "2026-08-16" -> "Sat, Aug 16"
  weekdayDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  },

  monthName(m1to12, style = 'short') {
    return new Date(Date.UTC(2026, m1to12 - 1, 1)).toLocaleDateString('en-US', { month: style, timeZone: 'UTC' });
  },

  // Format an ISO timestamp in the station's timezone, e.g. "Aug 17, 10:27 PM"
  localTime(ts, opts = {}) {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: CONFIG.timezone,
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      ...opts,
    });
  },

  clockTime(ts) {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: CONFIG.timezone, hour: 'numeric', minute: '2-digit',
    });
  },

  hourLabel(ts) {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: CONFIG.timezone, hour: 'numeric',
    });
  },

  // Hour of day (0-23, fractional) at the station, regardless of viewer tz.
  hourAtStation(ts) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date(ts));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return get('hour') + get('minute') / 60;
  },

  // ---- units -------------------------------------------------------------

  cToF: (c) => (c == null ? null : c * 9 / 5 + 32),
  kmhToMph: (v) => (v == null ? null : v * 0.621371),
  msToMph: (v) => (v == null ? null : v * 2.23694),
  paToInHg: (v) => (v == null ? null : v * 0.0002953),
  mmToIn: (v) => (v == null ? null : v / 25.4),

  // Convert a NWS quantitative value ({value, unitCode}) to imperial.
  nwsValue(q, kind) {
    if (!q || q.value == null) return null;
    const v = q.value;
    const u = q.unitCode || '';
    switch (kind) {
      case 'temp': return u.includes('degF') ? v : Util.cToF(v);
      case 'speed':
        if (u.includes('km_h')) return Util.kmhToMph(v);
        if (u.includes('m_s')) return Util.msToMph(v);
        return v; // already mph
      case 'pressure': return u.includes('Pa') ? Util.paToInHg(v) : v;
      case 'precip': return u.includes('mm') ? Util.mmToIn(v) : v;
      case 'percent': return v;
      default: return v;
    }
  },

  compass(deg) {
    if (deg == null) return '';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  },

  // ---- math & color --------------------------------------------------------

  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  lerp: (a, b, t) => a + (b - a) * t,

  hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  },

  rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map((v) => Math.round(Util.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  },

  mixHex(a, b, t) {
    const A = Util.hexToRgb(a), B = Util.hexToRgb(b);
    return Util.rgbToHex([Util.lerp(A[0], B[0], t), Util.lerp(A[1], B[1], t), Util.lerp(A[2], B[2], t)]);
  },

  // Interpolate along a list of [stopValue, hex] anchors.
  rampColor(anchors, v) {
    if (v <= anchors[0][0]) return anchors[0][1];
    for (let i = 1; i < anchors.length; i++) {
      if (v <= anchors[i][0]) {
        const [v0, c0] = anchors[i - 1];
        const [v1, c1] = anchors[i];
        return Util.mixHex(c0, c1, (v - v0) / (v1 - v0));
      }
    }
    return anchors[anchors.length - 1][1];
  },

  // Semantic-heat temperature scale (°F → color). A conventional weather
  // temperature ramp — multi-hue is deliberate here (semantic heat) and every
  // chart using it renders a labeled scale legend alongside.
  TEMP_ANCHORS: [
    [-10, '#b18cff'], [10, '#7aa7ff'], [32, '#5bc8e8'], [50, '#4fd0a0'],
    [65, '#a3d65c'], [75, '#f2c94c'], [85, '#f2994a'], [95, '#eb5757'], [105, '#d64545'],
  ],
  tempColor(f) {
    return f == null ? '#7b8a99' : Util.rampColor(Util.TEMP_ANCHORS, f);
  },

  // Sequential blue for precipitation magnitude on the dark surface:
  // near-zero recedes toward the panel, heavier rain steps lighter/brighter.
  PRECIP_ANCHORS: [
    [0, '#1b2a3e'], [0.1, '#1c4a74'], [0.35, '#2a6db3'], [0.75, '#3987e5'],
    [1.5, '#6fb1f5'], [3, '#a8d2fb'],
  ],
  precipColor(inches) {
    return Util.rampColor(Util.PRECIP_ANCHORS, inches ?? 0);
  },

  // ---- weather codes (Open-Meteo / WMO) -------------------------------------

  wmo(code) {
    const c = Number(code);
    const table = [
      [[0], 'Clear', 'clear'],
      [[1], 'Mostly clear', 'clear'],
      [[2], 'Partly cloudy', 'clouds'],
      [[3], 'Overcast', 'clouds'],
      [[45, 48], 'Fog', 'fog'],
      [[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
      [[61, 63, 66, 80, 81], 'Rain', 'rain'],
      [[65, 67, 82], 'Heavy rain', 'rain'],
      [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'],
      [[95, 96, 99], 'Thunderstorm', 'storm'],
    ];
    for (const [codes, label, kind] of table) {
      if (codes.includes(c)) return { label, kind };
    }
    return { label: '', kind: 'clear' };
  },

  // ---- climate normals -------------------------------------------------------

  // Normal precipitation accumulated from Jan 1 through the given ISO date
  // (linear within the month).
  normalToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    let total = 0;
    for (let i = 1; i < m; i++) total += CONFIG.normals.precip[i - 1];
    total += CONFIG.normals.precip[m - 1] * (d / Util.daysInMonth(y, m));
    return total;
  },

  // Normal precipitation for the month of `iso`, prorated to its day.
  normalMonthToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return CONFIG.normals.precip[m - 1] * (d / Util.daysInMonth(y, m));
  },

  // ---- formatting ----------------------------------------------------------

  fmt(v, digits = 0, suffix = '') {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(digits) + suffix;
  },

  fmtIn(v, digits = 2) { // precipitation in inches
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(digits) + '″';
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  // ---- cache (localStorage, namespaced, TTL-aware) -------------------------

  cacheGet(key, maxAgeMinutes = Infinity) {
    try {
      const raw = localStorage.getItem('wx:' + key);
      if (!raw) return null;
      const { at, data } = JSON.parse(raw);
      if ((Date.now() - at) / 60000 > maxAgeMinutes) return null;
      return data;
    } catch { return null; }
  },

  cacheSet(key, data) {
    try {
      localStorage.setItem('wx:' + key, JSON.stringify({ at: Date.now(), data }));
    } catch { /* storage full or unavailable — caching is best-effort */ }
  },

  cacheClear() {
    const gone = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('wx:') && k !== 'wx:apikey' && k !== 'wx:station') gone.push(k);
    }
    gone.forEach((k) => localStorage.removeItem(k));
  },

  // ---- misc ----------------------------------------------------------------

  el(id) { return document.getElementById(id); },

  async fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts);
    if (res.status === 204) return null; // WU returns 204 when a range has no data
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },

  // Map a forecast phrase to an emoji icon.
  wxIcon(text, isDay = true) {
    const t = (text || '').toLowerCase();
    if (t.includes('thunder')) return '⛈️';
    if (t.includes('snow') || t.includes('flurr')) return '🌨️';
    if (t.includes('sleet') || t.includes('ice') || t.includes('freezing')) return '🧊';
    if (t.includes('shower')) return '🌦️';
    if (t.includes('rain') || t.includes('drizzle')) return '🌧️';
    if (t.includes('fog') || t.includes('mist') || t.includes('haze') || t.includes('smoke')) return '🌫️';
    if (t.includes('mostly cloudy')) return '🌥️';
    if (t.includes('partly')) return isDay ? '⛅' : '☁️';
    if (t.includes('cloud') || t.includes('overcast')) return '☁️';
    if (t.includes('wind') || t.includes('breezy') || t.includes('blustery')) return '💨';
    if (t.includes('clear') || t.includes('sunny') || t.includes('fair')) return isDay ? '☀️' : '🌙';
    return isDay ? '🌤️' : '🌙';
  },
};
