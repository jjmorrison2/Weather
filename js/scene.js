// The living sky — a full-bleed scene behind the hero that mirrors the
// station's actual conditions: sky colors follow the real sun elevation,
// the sun and moon ride their computed arcs, the moon shows its true phase,
// stars come out on clear nights, cloud cover drives the cloud deck, and
// rain/snow/lightning appear when the station reports them.
//
// Layers (back to front):
//   sky gradient → stars (canvas) → sun/moon → cloud deck → hills → precip
//   (canvas) → lightning flash
//
// Respects prefers-reduced-motion: everything renders, nothing animates.

const Scene = {
  root: null,
  starsCanvas: null,
  precipCanvas: null,
  state: null,         // last inputs
  stars: [],
  drops: [],
  raf: null,
  lightningTimer: null,
  reducedMotion: false,

  // Sky palettes as [zenith, mid, horizon] stops, keyed by sun elevation.
  SKY_STOPS: [
    { el: -18, top: '#05070f', mid: '#080d18', bot: '#0b1120' },   // deep night
    { el: -9, top: '#060a14', mid: '#0d1526', bot: '#1a2440' },    // astro twilight
    { el: -4, top: '#0a1122', mid: '#1c2a4e', bot: '#5b4a68' },    // dusk/dawn
    { el: 0, top: '#12203f', mid: '#4a4a7a', bot: '#e8896a' },     // horizon glow
    { el: 6, top: '#274b7f', mid: '#6f8fc4', bot: '#f4b183' },     // golden hour
    { el: 15, top: '#3a6db3', mid: '#6fa3d8', bot: '#b8d4ea' },    // morning/evening
    { el: 40, top: '#3f7ec7', mid: '#7ab2e2', bot: '#c9e2f2' },    // midday
  ],

  init(root) {
    this.root = root;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.innerHTML = `
      <div class="sky"></div>
      <canvas class="stars"></canvas>
      <div class="sun"></div>
      <div class="moon"></div>
      <div class="clouds"></div>
      <svg class="hills" viewBox="0 0 1440 200" preserveAspectRatio="none" aria-hidden="true">
        <path class="hill hill-far" d="M0,200 L0,120 Q180,70 400,105 Q560,130 720,95 Q900,55 1100,100 Q1280,135 1440,90 L1440,200 Z"/>
        <path class="hill hill-near" d="M0,200 L0,150 Q200,110 430,140 Q650,165 860,130 Q1080,95 1260,140 Q1360,160 1440,150 L1440,200 Z"/>
        <g class="house" transform="translate(1150,116)">
          <rect x="-16" y="-14" width="32" height="16" rx="1"/>
          <path d="M-20,-13 L0,-28 L20,-13 Z"/>
          <rect class="window" x="-9" y="-10" width="7" height="7" rx="1"/>
          <rect class="window" x="3" y="-10" width="7" height="7" rx="1"/>
          <line class="vane" x1="12" y1="-28" x2="12" y2="-38"/>
          <path class="vane-arrow" d="M12,-38 l7,2.5 l-7,2.5 Z"/>
        </g>
      </svg>
      <canvas class="precip"></canvas>
      <div class="flash"></div>`;
    this.starsCanvas = root.querySelector('.stars');
    this.precipCanvas = root.querySelector('.precip');
    this.makeStars();
    window.addEventListener('resize', () => { this.sizeCanvases(); this.paintStars(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopLoop(); else this.startLoop();
    });
    this.sizeCanvases();
  },

  sizeCanvases() {
    for (const c of [this.starsCanvas, this.precipCanvas]) {
      if (!c) continue;
      c.width = this.root.clientWidth;
      c.height = this.root.clientHeight;
    }
  },

  makeStars() {
    this.stars = Array.from({ length: 150 }, () => ({
      x: Math.random(), y: Math.random() * 0.75,
      r: Math.random() * 1.3 + 0.4,
      tw: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.2,
    }));
  },

  // ---- inputs → scene state -------------------------------------------------

  // inputs: {tempF, cloudPct, kind: clear|clouds|fog|rain|snow|storm,
  //          precipRate (in/hr), windMph, now: Date}
  update(inputs) {
    this.state = { ...inputs };
    const now = inputs.now || new Date();
    const elev = Astro.sunElevation(now);
    const times = Astro.sunTimes(now);
    const moon = Astro.moon(now);
    const cloud = Util.clamp((inputs.cloudPct ?? 30) / 100, 0, 1);
    const kind = inputs.kind || 'clear';
    const raining = kind === 'rain' || kind === 'storm';
    const snowing = kind === 'snow';

    // --- sky gradient: interpolate stops by sun elevation, then flatten
    // toward gray with cloud cover and storm darkness.
    const stops = this.skyFor(elev);
    let { top, mid, bot } = stops;
    const gloom = Util.clamp(cloud * 0.55 + (kind === 'storm' ? 0.3 : raining ? 0.18 : 0), 0, 0.8);
    const dayGray = '#5c6a78', nightGray = '#0e1420';
    const gray = elev > 0 ? dayGray : nightGray;
    top = Util.mixHex(top, gray, gloom * 0.8);
    mid = Util.mixHex(mid, gray, gloom);
    bot = Util.mixHex(bot, gray, gloom * 0.9);
    this.root.querySelector('.sky').style.background =
      `linear-gradient(to bottom, ${top} 0%, ${mid} 55%, ${bot} 100%)`;

    // Publish scene tint to the page so chrome can echo it subtly.
    document.documentElement.style.setProperty('--scene-horizon', bot);
    document.documentElement.style.setProperty('--scene-zenith', top);

    // --- sun ---
    const sun = this.root.querySelector('.sun');
    if (times && elev > -1) {
      const frac = Util.clamp((now - times.sunrise) / (times.sunset - times.sunrise), 0, 1);
      const x = 8 + frac * 84; // % across
      const y = 78 - Util.clamp(elev / Math.max(20, times.maxElevation), 0, 1) * 62;
      const low = Util.clamp(1 - elev / 12, 0, 1); // near horizon → warmer
      const core = Util.mixHex('#fff6d8', '#ff9d5c', low * 0.85);
      const glow = Util.mixHex('#ffe9a8', '#ff7e4d', low * 0.9);
      sun.style.left = x + '%';
      sun.style.top = y + '%';
      sun.style.opacity = String((1 - cloud * 0.85) * Util.clamp((elev + 1) / 3, 0, 1));
      sun.style.background = `radial-gradient(circle, ${core} 0%, ${core} 26%, ${glow}55 45%, transparent 70%)`;
    } else {
      sun.style.opacity = '0';
    }

    // --- moon: shown at night on its own arc (fraction of the night elapsed —
    // an approximation; true moonrise/set would need a fuller ephemeris).
    const moonEl = this.root.querySelector('.moon');
    if (times && (elev < 2)) {
      let nightFrac;
      if (now > times.sunset) nightFrac = (now - times.sunset) / (86400000 - times.dayLengthMin * 60000);
      else nightFrac = 1 - (times.sunrise - now) / (86400000 - times.dayLengthMin * 60000);
      nightFrac = Util.clamp(nightFrac, 0.02, 0.98);
      const x = 10 + nightFrac * 80;
      const y = 70 - Math.sin(nightFrac * Math.PI) * 52;
      moonEl.style.left = x + '%';
      moonEl.style.top = y + '%';
      moonEl.style.opacity = String(Util.clamp((2 - elev) / 6, 0, 1) * (1 - cloud * 0.75));
      moonEl.innerHTML = this.moonSVG(moon, 64);
    } else {
      moonEl.style.opacity = '0';
    }

    // --- stars ---
    this.starAlpha = Util.clamp((-elev - 2) / 8, 0, 1) * (1 - cloud * 0.9);

    // --- clouds ---
    this.buildClouds(cloud, elev, kind, inputs.windMph ?? 5);

    // --- hills & house ---
    const hillDark = Util.clamp((-elev + 8) / 20, 0.25, 1);
    this.root.querySelector('.hill-far').style.fill = Util.mixHex('#31543e', '#0a1016', hillDark * 0.9);
    this.root.querySelector('.hill-near').style.fill = Util.mixHex('#274434', '#070b10', hillDark);
    this.root.querySelectorAll('.window').forEach((w) => {
      w.style.fill = elev < 0 ? '#ffd88a' : '#1c2a33';
      w.style.filter = elev < 0 ? 'drop-shadow(0 0 4px rgba(255,205,110,.9))' : 'none';
    });
    const vane = this.root.querySelector('.vane-arrow');
    if (vane) vane.setAttribute('transform', `rotate(${(inputs.windDirDeg ?? 270) - 90}, 12, -38)`);

    // --- precip particles ---
    this.setupPrecip(kind, inputs.precipRate ?? 0, inputs.windMph ?? 5, snowing);

    // --- lightning ---
    clearTimeout(this.lightningTimer);
    if (kind === 'storm' && !this.reducedMotion) this.scheduleLightning();

    this.startLoop();
    if (this.reducedMotion) { this.paintStars(); this.paintPrecipStatic(); }
  },

  skyFor(elev) {
    const s = this.SKY_STOPS;
    if (elev <= s[0].el) return s[0];
    for (let i = 1; i < s.length; i++) {
      if (elev <= s[i].el) {
        const t = (elev - s[i - 1].el) / (s[i].el - s[i - 1].el);
        return {
          top: Util.mixHex(s[i - 1].top, s[i].top, t),
          mid: Util.mixHex(s[i - 1].mid, s[i].mid, t),
          bot: Util.mixHex(s[i - 1].bot, s[i].bot, t),
        };
      }
    }
    return s[s.length - 1];
  },

  // Draw the moon with its real phase: a light disc masked by a shifted
  // shadow disc. `phase` 0=new, .5=full; waxing lights the right side.
  moonSVG(moon, size) {
    const r = size / 2 - 2;
    const c = size / 2;
    // Shadow-disc offset: 0 at new (fully covered) → 2r at full (no shadow),
    // shifted away from the lit side (waxing lights the right → shadow left).
    const t = Math.cos(Math.PI * 2 * moon.phase); // 1=new, -1=full
    const off = (1 - t) * r * (moon.waxing ? -1 : 1);
    const id = `moonmask${size}-${Math.round(moon.phase * 1000)}`;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <defs><mask id="${id}">
        <rect width="${size}" height="${size}" fill="black"/>
        <circle cx="${c}" cy="${c}" r="${r}" fill="white"/>
        <circle cx="${c + off}" cy="${c}" r="${r}" fill="black"/>
      </mask></defs>
      <circle cx="${c}" cy="${c}" r="${r}" fill="#2c3542"/>
      <g mask="url(#${id})">
        <circle cx="${c}" cy="${c}" r="${r}" fill="#e8e4d8"/>
        <circle cx="${c - r * 0.3}" cy="${c - r * 0.25}" r="${r * 0.16}" fill="#cfcabb"/>
        <circle cx="${c + r * 0.25}" cy="${c + r * 0.2}" r="${r * 0.11}" fill="#d6d1c2"/>
        <circle cx="${c + r * 0.05}" cy="${c - r * 0.45}" r="${r * 0.08}" fill="#d6d1c2"/>
      </g></svg>`;
  },

  buildClouds(cover, elev, kind, windMph) {
    const holder = this.root.querySelector('.clouds');
    const count = Math.round(cover * 9) + (kind === 'fog' ? 4 : 0);
    const day = elev > 0;
    const stormy = kind === 'storm';
    let html = '';
    // Deterministic pseudo-random layout so re-renders don't jump.
    let seed = 42;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < count; i++) {
      const layer = i % 3; // 0 far … 2 near
      const w = 180 + rand() * 320 + layer * 120;
      const y = 4 + rand() * (kind === 'fog' ? 70 : 42);
      const x = rand() * 110 - 10;
      const bright = day ? (stormy ? 0.35 : 0.9 - layer * 0.12) : 0.16 - layer * 0.03;
      const tone = stormy
        ? Util.mixHex('#4a545f', '#242b33', layer / 2)
        : day ? Util.mixHex('#ffffff', '#9fb2c4', layer / 2) : Util.mixHex('#39434f', '#1b222b', layer / 2);
      const dur = Util.clamp(320 / (windMph + 3) * (3 - layer), 40, 480);
      html += `<div class="cloud layer-${layer}" style="
        width:${w}px; height:${w * 0.3}px; top:${y}%; left:${x}%;
        background:${tone}; opacity:${Util.clamp(bright * (0.55 + cover * 0.5), 0.08, 0.95)};
        animation-duration:${dur}s; animation-delay:-${rand() * dur}s;"></div>`;
    }
    holder.innerHTML = html;
  },

  // ---- animation loop ---------------------------------------------------------

  setupPrecip(kind, rate, windMph, snowing) {
    const n = kind === 'rain' || kind === 'storm'
      ? Math.round(Util.clamp(40 + rate * 260, 40, 420))
      : snowing ? 140 : 0;
    const W = this.precipCanvas.width, H = this.precipCanvas.height;
    this.precipKind = n === 0 ? null : (snowing ? 'snow' : 'rain');
    this.wind = windMph;
    this.drops = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      v: snowing ? 0.6 + Math.random() * 1 : 9 + Math.random() * 9,
      l: snowing ? 1.5 + Math.random() * 2 : 9 + Math.random() * 14,
      drift: Math.random() * Math.PI * 2,
    }));
  },

  startLoop() {
    if (this.raf || this.reducedMotion || document.hidden) return;
    const tick = () => {
      this.paintStars();
      this.paintPrecip();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  stopLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = null;
  },

  paintStars() {
    const ctx = this.starsCanvas.getContext('2d');
    const { width: W, height: H } = this.starsCanvas;
    ctx.clearRect(0, 0, W, H);
    if (!this.starAlpha) return;
    const t = performance.now() / 1000;
    for (const s of this.stars) {
      const tw = this.reducedMotion ? 0.75 : 0.55 + 0.45 * Math.sin(t * s.speed + s.tw);
      ctx.globalAlpha = this.starAlpha * tw;
      ctx.fillStyle = '#dfe9f5';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  paintPrecip() {
    const ctx = this.precipCanvas.getContext('2d');
    const { width: W, height: H } = this.precipCanvas;
    ctx.clearRect(0, 0, W, H);
    if (!this.precipKind) return;
    const slant = Util.clamp(this.wind / 6, 0, 5);
    if (this.precipKind === 'rain') {
      ctx.strokeStyle = 'rgba(190,215,240,0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const d of this.drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - slant * (d.l / 10), d.y + d.l);
        d.y += d.v; d.x -= slant * (d.v / 10);
        if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 80); }
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(235,242,250,0.85)';
      for (const d of this.drops) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.l, 0, Math.PI * 2);
        ctx.fill();
        d.y += d.v;
        d.x += Math.sin((d.y / 40) + d.drift) * 0.6 - slant * 0.12;
        if (d.y > H) { d.y = -8; d.x = Math.random() * W; }
      }
    }
  },

  paintPrecipStatic() { this.paintPrecip(); },

  scheduleLightning() {
    const flash = this.root.querySelector('.flash');
    const strike = () => {
      flash.classList.remove('striking');
      void flash.offsetWidth; // restart the animation
      flash.classList.add('striking');
      this.lightningTimer = setTimeout(strike, 5000 + Math.random() * 11000);
    };
    this.lightningTimer = setTimeout(strike, 2500 + Math.random() * 5000);
  },
};
