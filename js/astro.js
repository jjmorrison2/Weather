// Solar and lunar astronomy, computed locally — no API needed.
// Solar math follows the NOAA General Solar Position Calculations
// (fractional-year Fourier series for declination and the equation of time,
// then hour-angle geometry). Accuracy is within a minute or two, which is
// plenty for a dashboard.

const Astro = {
  rad: (d) => (d * Math.PI) / 180,
  deg: (r) => (r * 180) / Math.PI,

  // Fractional year (radians) for a Date, using UTC day-of-year and hour.
  fractionalYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const doy = (date.getTime() - start) / 86400000; // 0-based, fractional
    return ((2 * Math.PI) / 365) * doy;
  },

  // Equation of time (minutes) and solar declination (radians).
  eqTimeDecl(date) {
    const g = this.fractionalYear(date);
    const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return { eqTime, decl };
  },

  // Sun elevation (degrees above the horizon) at an instant.
  sunElevation(date, lat = CONFIG.lat, lon = CONFIG.lon) {
    const { eqTime, decl } = this.eqTimeDecl(date);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const tst = (utcMinutes + eqTime + 4 * lon + 1440) % 1440; // true solar time
    const ha = this.rad(tst / 4 - 180); // hour angle
    const latR = this.rad(lat);
    const cosZenith = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
    return 90 - this.deg(Math.acos(Math.max(-1, Math.min(1, cosZenith))));
  },

  // Sunrise / sunset / solar noon for the calendar date containing `date`
  // (evaluated in the station's timezone). Returns Date objects (UTC epoch)
  // plus day length in minutes.
  sunTimes(date, lat = CONFIG.lat, lon = CONFIG.lon) {
    // Anchor the calculation at local noon of the station-local calendar day.
    const dayISO = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(date);
    // Approximate local noon in UTC: 12:00 minus longitude offset (lon is
    // negative west, so -4*lon minutes east of Greenwich noon).
    const [y, m, d] = dayISO.split('-').map(Number);
    const approxNoonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) - (4 * lon) * 60000);
    const { eqTime, decl } = this.eqTimeDecl(approxNoonUTC);

    const latR = this.rad(lat);
    const zenith = this.rad(90.833); // official sunrise/sunset zenith (refraction + disc)
    const cosHa = (Math.cos(zenith) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
    if (cosHa < -1 || cosHa > 1) return null; // polar day/night — not at this latitude

    const haDeg = this.deg(Math.acos(cosHa));
    // Minutes past UTC midnight of that calendar date:
    const sunriseMin = 720 - 4 * (lon + haDeg) - eqTime;
    const sunsetMin = 720 - 4 * (lon - haDeg) - eqTime;
    const noonMin = 720 - 4 * lon - eqTime;
    const base = Date.UTC(y, m - 1, d);
    return {
      sunrise: new Date(base + sunriseMin * 60000),
      sunset: new Date(base + sunsetMin * 60000),
      solarNoon: new Date(base + noonMin * 60000),
      dayLengthMin: sunsetMin - sunriseMin,
      maxElevation: 90 - Math.abs(lat - this.deg(decl)),
    };
  },

  // ---- moon --------------------------------------------------------------

  SYNODIC: 29.530588853, // days
  // A recent new moon epoch (2000-01-06 18:14 UTC) — good enough for phase.
  NEW_MOON_EPOCH: Date.UTC(2000, 0, 6, 18, 14),

  moon(date) {
    const days = (date.getTime() - this.NEW_MOON_EPOCH) / 86400000;
    const phase = ((days / this.SYNODIC) % 1 + 1) % 1; // 0 = new, 0.5 = full
    const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
      'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
    const emoji = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    // Octile with a tight window for the four "exact" phases.
    let idx;
    const p = phase;
    if (p < 0.02 || p > 0.98) idx = 0;
    else if (p < 0.23) idx = 1;
    else if (p < 0.27) idx = 2;
    else if (p < 0.48) idx = 3;
    else if (p < 0.52) idx = 4;
    else if (p < 0.73) idx = 5;
    else if (p < 0.77) idx = 6;
    else idx = 7;
    const daysUntil = (target) => ((target - phase + 1) % 1) * this.SYNODIC;
    return {
      phase, illum,
      age: phase * this.SYNODIC,
      name: names[idx], emoji: emoji[idx],
      waxing: phase < 0.5,
      nextFull: new Date(date.getTime() + daysUntil(0.5) * 86400000),
      nextNew: new Date(date.getTime() + daysUntil(1.0) * 86400000),
    };
  },
};
