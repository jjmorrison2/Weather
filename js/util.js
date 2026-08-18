// Small shared helpers: dates (in the station's timezone), unit conversion,
// formatting, localStorage caching, and DOM shortcuts.

const Util = {
  // ---- dates -------------------------------------------------------------

  // Today's calendar date (YYYY-MM-DD) in the station's timezone, regardless
  // of the viewer's timezone.
  todayISO() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CONFIG.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  },

  // Add days to a YYYY-MM-DD string (pure calendar math, timezone-safe).
  addDaysISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
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

  // Format an ISO timestamp in the station's timezone, e.g. "Aug 17, 10:27 PM"
  localTime(ts, opts = {}) {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: CONFIG.timezone,
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      ...opts,
    });
  },

  hourLabel(ts) {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: CONFIG.timezone, hour: 'numeric',
    });
  },

  // Hour of day (0-23) at the station, regardless of the viewer's timezone.
  hourAtStation(ts) {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.timezone, hour: 'numeric', hourCycle: 'h23',
    }).format(new Date(ts)));
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

  // ---- formatting ----------------------------------------------------------

  fmt(v, digits = 0, suffix = '') {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(digits) + suffix;
  },

  fmtIn(v) { // precipitation in inches
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(2) + '"';
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
      if (k && k.startsWith('wx:')) gone.push(k);
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
