// Fireworks: a full-screen overlay canvas that only runs while something is
// in the air. A strike sends up a volley; a turkey or a win sends a bigger
// one. Rockets whistle up, burst into rainbow rings, and the sparks fall and
// fade. Pointer events pass straight through, so it never blocks a tap.

const Fireworks = {
  cv: null, ctx: null, rockets: [], sparks: [], raf: 0, last: 0, W: 0, H: 0, dpr: 1, queue: [],

  init(cv) { this.cv = cv; this.ctx = cv.getContext("2d"); },
  fit() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
  },

  // n rockets over `spread` seconds; big = taller, fuller bursts
  show(n, opts) {
    if (!this.cv) return;
    const o = Object.assign({ spread: 1.2, big: false, top: 0.12, bottom: 0.55 }, opts);
    if (!Motion.on) n = Math.min(n, 2);
    this.fit();
    for (let i = 0; i < n; i++) this.queue.push({ at: (i / Math.max(1, n - 1)) * o.spread * (n > 1 ? 1 : 0), o });
    this.qT = 0;
    if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); }
  },
  clear() { this.rockets.length = 0; this.sparks.length = 0; this.queue.length = 0; if (this.ctx) this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); },

  launch(o) {
    const W = this.W, H = this.H;
    const x = W * (0.15 + Math.random() * 0.7), ty = H * (o.top + Math.random() * (o.bottom - o.top));
    const vy = -Math.sqrt(2 * 700 * (H - ty));
    this.rockets.push({ x, y: H + 10, vx: (Math.random() - 0.5) * 60, vy, ty, col: RAINBOW[Math.floor(Math.random() * 7)], big: o.big, trail: [] });
    Sfx.whistle(0.45);
  },
  explode(r) {
    const n = r.big ? 70 : 46, sp = (r.big ? 260 : 200) * Math.min(1.3, Math.max(0.7, this.W / 420));
    const ring = Math.random() < 0.5;
    const off = Math.floor(Math.random() * 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.05, s = ring ? sp : sp * (0.35 + Math.random() * 0.75);
      this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.1 + Math.random() * 0.5, age: 0, col: RAINBOW[(off + Math.floor(i / (n / 7))) % 7], px: r.x, py: r.y });
    }
    // a white flash core
    for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, s = 60 * Math.random(); this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, age: 0, col: "#ffffff", px: r.x, py: r.y }); }
    Sfx.boom(); if (Math.random() < 0.6) Sfx.crackle();
  },

  frame(t) {
    const dt = this.last ? Math.max(0, Math.min(0.05, (t - this.last) / 1000)) : 0.016;
    this.last = t;
    this.qT = (this.qT || 0) + dt;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].at <= this.qT) { this.launch(this.queue[i].o); this.queue.splice(i, 1); }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.globalCompositeOperation = "lighter";
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.trail.push(r.x, r.y); if (r.trail.length > 16) r.trail.splice(0, 2);
      r.vy += 700 * dt; r.x += r.vx * dt; r.y += r.vy * dt;
      c.strokeStyle = r.col; c.lineWidth = 2.5; c.beginPath();
      for (let k = 0; k < r.trail.length; k += 2) (k ? c.lineTo : c.moveTo).call(c, r.trail[k], r.trail[k + 1]);
      c.stroke();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(r.x, r.y, 2.5, 0, Math.PI * 2); c.fill();
      if (r.vy >= -40 || r.y <= r.ty) { this.explode(r); this.rockets.splice(i, 1); }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) { this.sparks.splice(i, 1); continue; }
      s.px = s.x; s.py = s.y;
      s.vx *= 1 - dt * 1.6; s.vy = s.vy * (1 - dt * 1.6) + 160 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const a = 1 - s.age / s.life;
      c.globalAlpha = a; c.strokeStyle = s.col; c.lineWidth = 2.6 * a + 0.6;
      c.beginPath(); c.moveTo(s.px - s.vx * 0.03, s.py - s.vy * 0.03); c.lineTo(s.x, s.y); c.stroke();
      // twinkle as they fade
      if (a < 0.5 && Math.random() < 0.3) { c.fillStyle = "#fff"; c.fillRect(s.x - 1, s.y - 1, 2, 2); }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    if (this.rockets.length || this.sparks.length || this.queue.length) this.raf = requestAnimationFrame((tt) => this.frame(tt));
    else { this.raf = 0; c.clearRect(0, 0, this.W, this.H); }
  },
};
