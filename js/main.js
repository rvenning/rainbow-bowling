// App shell and the play loop. Profiles, PINs, sync, install and the version
// line come from gamekit; this file decides what each screen shows, who is
// bowling, and turns engine events into sound, light and words.

const AVATARS = ["🦄", "🐰", "🦊", "🐼", "🐸", "🐯", "🦖", "🐙", "🦉", "🐧", "🐝", "🐨"];
const MAX_PLAYERS = 4;
const ROBO = { id: "robo", name: "Robo-Rolly", avatar: "🤖", bot: true, skill: "robo" };
const esc = (s) => GK.util.esc(String(s));
const $ = (id) => document.getElementById(id);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ------------------------------------------------------------------- play --
const Play = {
  match: null, view: null, raf: 0, last: 0, paused: false, token: 0, t: 0,
  hudSig: "", pinSig: "", traySig: "", turnBlock: 0, botT: 0, botPlan: null, botAim: null,
  sfxGap: 0, nudgeTimer: 0, cfg: null,

  boot() {
    this.view = new View($("cv"));
    Input.bind($("game-stage"), this.view);
    Input.ballX = () => (this.match ? this.match.lane.ball.x : 0);
    Input.canStart = () => {
      if (this.turnBlock > 0) { this.hideTurn(); return false; }
      return this.humanTurn();
    };
    Input.ideal = (hand) => (this.match ? this.match.lane.aimPoint(hand) : 0);
    Input.onAim = (a) => {
      this.showPower(a);
    };
    Input.onCancel = () => { clearTimeout(this._pw); $("power").classList.remove("on"); };
    Input.onSlide = (x) => {
      if (!this.humanTurn()) return x;
      const b = this.match.lane.ball;
      b.x = clampStart(x); this.match.cur.x0 = b.x;
      return b.x;
    };
    Input.onTap = () => { this.hintTapT = this.t + 4; };
    Input.onBowl = (a) => {
      if (!this.humanTurn()) { $("power").classList.remove("on"); return; }
      const m = this.match;
      m.cur.x0 = m.lane.ball.x;
      m.throw(m.lane.ball.x, a.target, a.pow, a.curve);
      // the power bar stays up a moment to say how hard it was
      this.showPower(a);
      clearTimeout(this._pw); this._pw = setTimeout(() => $("power").classList.remove("on"), 900);
      const s = Storage.getSettings(); s.throws = (s.throws || 0) + 1; if (s.throws <= 6) Storage.saveSettings(s);
      this.hintAuto = s.throws < 4; this.hintTapT = 0;
    };
    $("tray").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (!b || !this.humanTurn()) return;
      this.match.arm(b.dataset.p);
      const p = this.match.cur;
      if (p.armed) GK.UI.toast(`${POWERS[p.armed].icon} ${POWERS[p.armed].name}: ${POWERS[p.armed].tip}`);
    });
    $("turn-card").addEventListener("click", () => this.hideTurn());
    window.addEventListener("resize", () => setTimeout(() => { this.view.resize(); }, 60));
    document.addEventListener("keydown", (e) => {
      if (GK.UI.screen !== "game" || !this.match) return;
      if (e.key === "ArrowLeft") this.nudge(-1);
      else if (e.key === "ArrowRight") this.nudge(1);
      else if (e.key === "p" || e.key === "Escape") this.paused ? this.resume() : this.pause();
    });
  },

  humanTurn() {
    const m = this.match;
    return !!(m && !this.paused && m.canThrow() && !m.cur.bot && this.turnBlock <= 0);
  },
  // keyboard arrows move the ball too
  nudge(dir) {
    if (!this.humanTurn() || Input.press) return;
    const b = this.match.lane.ball, before = b.x;
    b.x = clampStart(b.x + dir * 1.25);
    if (b.x !== before) { Sfx.nudge(); this.match.cur.x0 = b.x; }
  },

  showPower(a) {
    const pw = $("power");
    pw.classList.add("on"); pw.classList.toggle("hot", a.pow > 0.85);
    pw.querySelector("i").style.height = Math.round(8 + a.pow * 92) + "%";
    pw.querySelector("b").textContent = a.word || "";
  },

  // The swipe hint: a finger showing the flick, sitting on the ball. Shown
  // whenever a person (not Robo-Rolly) is about to bowl, for the first few
  // throws on this device, and for a few seconds after a tap that was not a
  // swipe. Hidden the moment a finger is on the lane.
  placeHint() {
    const h = $("hint"), m = this.match;
    const show = !!m && (this.hintAuto || this.t < this.hintTapT) && this.humanTurn() && m.lane.ball.state === "ready" && !Input.mode;
    if (h.classList.contains("gone") === show) h.classList.toggle("gone", !show);
    if (!show) return;
    const p = this.view.P(m.lane.ball.x, 0, -10);
    if (!p) return;
    const r = $("cv").getBoundingClientRect(), s = $("game-stage").getBoundingClientRect();
    h.style.left = Math.round(p[0] + r.left - s.left) + "px";
    h.style.top = Math.round(p[1] + r.top - s.top) + "px";
  },

  // cfg: { players: [...], mode: "solo"|"party" }
  start(cfg) {
    this.cfg = cfg;
    const pace = Storage.getSettings().fast ? 1.8 : 1;
    this.match = new Match({ players: cfg.players.map((p) => ({ ...p, x0: p.x0 || 0 })), seed: (Date.now() & 0x7fffffff) || 7, pace });
    this.token++;
    this.paused = false; this.ending = false; this.hudSig = ""; this.pinSig = ""; this.traySig = "";
    this.hideTurn(); this.botT = 0; this.botPlan = null; this.botAim = null;
    clearTimeout(this._st); $("power").classList.remove("on");
    Fx.reset(); Fireworks.clear();
    GK.UI.showScreen("game");
    this.view.resize(); this.view.camU = 0; this.view.trail.length = 0;
    $("stamp").className = "stamp";
    this.hintAuto = (Storage.getSettings().throws || 0) < 4; this.hintTapT = 0;
    Input.enabled = true;
    this.hud();
    if (this.match.players.length > 1) this.showTurn(0);
    if (!this.raf) this.loop();
  },

  loop() {
    const tick = (t) => { this.raf = requestAnimationFrame(tick); this.frame(t); };
    this.raf = requestAnimationFrame(tick);
  },

  // One frame. Schedules nothing itself, so a test can step it by hand.
  frame(t) {
    if (GK.UI.screen !== "game" || !this.match) { this.last = 0; Rumble.off(); return; }
    let dt = this.last ? (t - this.last) / 1000 : 0;
    this.last = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(0.05, dt);
    GK.Debug.frame(dt);
    this.view.checkSize();
    const m = this.match;
    if (!this.paused && dt > 0) {
      this.t += dt;
      if (this.turnBlock > 0) { this.turnBlock -= dt; if (this.turnBlock <= 0) this.hideTurn(); }
      this.botStep(dt);
      m.tick(dt);
      Fx.update(dt);
      this.drain();
      this.hud();
      const b = m.lane.ball;
      if (b.state === "rolling" || b.state === "gutter") Rumble.set(Math.hypot(b.vx, b.vz) / LANE.MAX_SPEED, b.z > LANE.DECK);
      else Rumble.off();
    } else if (this.paused) Rumble.off();
    const lane = m.lane, cur = m.cur;
    const aim = Input.aim ? { target: Input.aim.target, pow: Input.aim.pow, curve: Input.aim.curve } : this.botAim;
    this.placeHint();
    this.view.draw({
      lane, t: this.t, dt: this.paused ? 0 : dt, fx: true, aim,
      power: lane.ball.state !== "ready" ? lane.power : null, armed: cur.armed,
      seatCol: SEATS[m.seat], bumpersShown: lane.ball.state === "ready" && (cur.bumpers || cur.armed === "lucky"),
      sweep: m.phase === "sweep" ? Math.min(1, m.phaseT / SWEEP_T) : null,
      rackT: m.rackT, hold: m.phase === "result" || (m.phase === "sweep" && m.phaseT < SWEEP_MID),
      home: m.phase === "aim",
    });
  },

  // The computer player: think, show its aim for a moment, bowl.
  botStep(dt) {
    const m = this.match;
    if (!m.cur.bot || this.turnBlock > 0 || !m.canThrow()) { this.botT = 0; this.botPlan = null; this.botAim = null; return; }
    this.botT += dt;
    if (!this.botPlan && this.botT > 0.5) {
      this.botPlan = Bot.plan(m.lane, m.cur.skill || "robo", Math.random, { powers: m.cur.powers });
      m.lane.ball.x = clampStart(this.botPlan.x0);
      if (this.botPlan.arm) m.arm(this.botPlan.arm);
    }
    if (this.botPlan) {
      const k = Math.min(1, (this.botT - 0.5) / 0.9);
      this.botAim = { target: m.lane.ball.x + (this.botPlan.target - m.lane.ball.x) * (0.4 + 0.6 * k), pow: this.botPlan.power * k };
      if (this.botT > 1.6) { const p = this.botPlan; this.botPlan = null; this.botAim = null; m.throw(m.lane.ball.x, p.target, p.power); }
    }
  },

  // Engine events become sound, light and words.
  drain() {
    const m = this.match, v = this.view, R = !Motion.on;
    this.sfxGap -= 1;
    const at = (x, z, y) => v.P(x, y || 6, z);
    for (const e of m.events) {
      switch (e.type) {
        case "launch": Sfx.release(e.speed / LANE.MAX_SPEED); break;
        case "hit": {
          Sfx.pin(e.v, e.n || 1);
          const p = at(e.x, e.z);
          if (p) for (let i = 0; i < (R ? 3 : 8); i++) Fx.burst(p[0], p[1], RAINBOW[(i + (e.n || 0)) % 7], 1, 150, 0.5, 2.6);
          if (!R && e.v > 200) Fx.addShake(3);
          break;
        }
        case "clack": if (this.sfxGap <= 0) { Sfx.clack(e.v, e.n || 1); this.sfxGap = 2; } break;
        case "kick": Sfx.kick(e.v); break;
        case "bumper": { Sfx.bumper(); const p = at(e.x, e.z, 2); if (p) for (let i = 0; i < 6; i++) Fx.burst(p[0], p[1], RAINBOW[i], 1, 90, 0.4, 2); break; }
        case "gutter": Sfx.gutter(); break;
        case "pit": Sfx.pit(); break;
        case "burst": {
          Sfx.burst();
          const p = at(e.x, e.z + 14, 4);
          if (p) { for (let i = 0; i < (R ? 10 : 40); i++) Fx.burst(p[0], p[1], RAINBOW[i % 7], 1, 260, 0.8, 3); Fx.sparkle(p[0], p[1], "#fff7c0", 12); }
          Fx.addFlash(0.35, "#fff6c2");
          break;
        }
        case "arm": Sfx.arm(!!e.id); break;
        case "roll": this.result(e); break;
        case "rack": if (e.fresh) Sfx.rack(); m.lane.ball.x = clampStart(m.cur.x0 || 0); break;
        case "turn":
          m.lane.ball.x = clampStart(m.cur.x0 || 0);
          Sfx.rack();
          if (e.changed && m.players.length > 1) this.showTurn(e.seat);
          break;
        case "over": this.gameOver(); break;
      }
    }
    m.events.length = 0;
  },

  result(e) {
    const m = this.match, pl = m.players[e.seat], multi = m.players.length > 1;
    const who = multi ? `${pl.name}: ` : "";
    if (e.strike) {
      Sfx.crash(); Sfx.strike();
      const word = e.streak >= 12 ? "PERFECT!" : e.streak >= 4 ? `${e.streak} IN A ROW!` : e.streak === 3 ? "TURKEY!" : e.streak === 2 ? "DOUBLE!" : "STRIKE!";
      this.stamp(word, who + (e.streak === 3 ? "Three strikes in a row!" : "All ten pins!"), "strike", 2100);
      const big = e.streak >= 3;
      Fireworks.show(big ? 9 : 5, { spread: big ? 1.8 : 1.1, big });
      if (big) Sfx.turkey();
      Fx.addFlash(0.3, "#ffffff");
    } else if (e.spare) {
      const which = Sfx.silly();
      const word = { slide: "Wheee!", boing: "Boing boing!", honk: "Honk honk!", kazoo: "Wah-hoo!" }[which];
      this.stamp(e.converted ? "SPLIT SPARE!" : "SPARE!", who + word, "spare", 1600);
      if (e.converted) Sfx.converted();
      const p = this.view.P(0, 10, LANE.HEAD + 12);
      if (p) for (let i = 0; i < (Motion.on ? 26 : 8); i++) Fx.burst(p[0], p[1], RAINBOW[i % 7], 1, 220, 0.7, 3);
    } else if (e.gutter) {
      Sfx.wahwah();
      this.stamp("Gutter ball", who + (e.ball === 0 ? "Shake it off, one more go!" : "Next frame!"), "miss", 1300);
    } else if (e.split) {
      Sfx.split();
      this.stamp(`${e.knocked} pins · Split!`, who + "Tricky! Aim between them.", "split", 1300);
    } else {
      const left = e.standing.length;
      const word = e.knocked === 0 ? "Missed!" : e.knocked === 9 && e.ball === 0 ? "9 pins!" : `${e.knocked} ${e.knocked === 1 ? "pin" : "pins"}`;
      const sub = e.ball === 0 ? (left === 1 ? "Just one left. You can do it!" : `${left} left for a spare`) : e.knocked > 0 ? "Nice!" : "Next frame!";
      this.stamp(word, who + sub, e.knocked >= 7 ? "good" : "plain", 1200);
    }
    if (e.award) {
      setTimeout(() => { if (this.match === m) { Sfx.power(); this.traySig = ""; GK.UI.toast(`${POWERS[e.award].icon} Power-up! ${POWERS[e.award].name}. Tap it to use it.`); } }, 900);
    }
  },

  stamp(word, sub, tier, ms) {
    const s = $("stamp");
    s.innerHTML = `<b>${esc(word)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}`;
    s.className = "stamp show t-" + tier;
    clearTimeout(this._st); this._st = setTimeout(() => { s.className = "stamp"; }, ms);
  },
  showTurn(seat) {
    const pl = this.match.players[seat], c = $("turn-card");
    c.style.setProperty("--seat", SEATS[seat]);
    c.innerHTML = `<span class="tc-av">${esc(pl.avatar)}</span><b>${esc(pl.name)}'s turn!</b><small>${pl.bot ? "Watch Robo-Rolly bowl" : "Frame " + (this.match.where(pl).frame + 1) + " · tap to start"}</small>`;
    c.classList.remove("show"); void c.offsetWidth; c.classList.add("show");
    Sfx.turn();
    this.turnBlock = pl.bot ? 1.2 : 2.4;
  },
  hideTurn() { this.turnBlock = 0; $("turn-card").classList.remove("show"); },

  // ----------------------------------------------------------- the HUD --
  hud() {
    const m = this.match, cur = m.cur, w = m.where();
    const sig = [m.seat, cur.rolls.length, m.phase === "aim", m.over].join("|");
    if (sig !== this.hudSig) {
      this.hudSig = sig;
      $("sheet").innerHTML = this.sheetHtml(cur, w.frame) + (m.players.length > 1 ? `<span class="sheet-others">${m.players.map((p, i) => i === m.seat ? "" : `<i style="--seat:${SEATS[i]}">${esc(p.avatar)} ${Scoring.total(p.rolls)}</i>`).join("")}</span>` : "");
      const pp = $("hud-player");
      pp.style.setProperty("--seat", SEATS[m.seat]);
      pp.lastElementChild.textContent = `${cur.avatar} ${cur.name}`;
      $("hud-frame").innerHTML = w.done ? "<b>Done!</b>" : `<b>Frame ${w.frame + 1}</b><small>Ball ${w.ball + 1}</small>`;
      $("hud-frame").setAttribute("aria-label", w.done ? "Game finished" : `Frame ${w.frame + 1}, ball ${w.ball + 1}`);
    }
    const ps = m.lane.standingNums().join(",");
    if (ps !== this.pinSig) {
      this.pinSig = ps;
      const up = new Set(m.lane.standingNums());
      const rows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
      $("pin-map").innerHTML = rows.map((r) => `<span>${r.map((n) => `<i class="${up.has(n) ? "up" : ""}"></i>`).join("")}</span>`).join("");
      $("pin-map").setAttribute("aria-label", `${up.size} pins standing`);
    }
    const ts = [m.seat, cur.powers.join(","), cur.armed, this.humanTurn()].join("|");
    if (ts !== this.traySig) {
      this.traySig = ts;
      const can = this.humanTurn();
      $("tray").innerHTML = cur.powers.length
        ? cur.powers.map((id, i) => `<button data-p="${id}" class="pw${cur.armed === id && cur.powers.indexOf(id) === i ? " on" : ""}" ${can ? "" : "disabled"} aria-pressed="${cur.armed === id ? "true" : "false"}" aria-label="${POWERS[id].name}: ${POWERS[id].tip}"><span>${POWERS[id].icon}</span><small>${POWERS[id].short}</small></button>`).join("")
        : `<span class="tray-empty">Knock down every pin to win a power-up</span>`;
    }
  },
  // One player's ten boxes, as a compact strip.
  sheetHtml(p, now) {
    const fr = Scoring.frames(p.rolls);
    let h = `<span class="sheet-row">`;
    fr.forEach((f, i) => {
      const mk = Scoring.marks(f, i === 9);
      h += `<span class="fbox${i === now ? " now" : ""}${i === 9 ? " tenth" : ""}"><span class="fm">${mk.map((x) => `<i class="${x === "X" ? "x" : x === "/" ? "s" : ""}">${x}</i>`).join("")}</span><span class="fs">${f.score != null ? f.score : ""}</span></span>`;
    });
    return h + `<span class="fbox tot"><span class="fm">Total</span><span class="fs">${Scoring.total(p.rolls)}</span></span></span>`;
  },

  gameOver() {
    if (this.ending) return;
    this.ending = true; Input.enabled = false;
    const token = this.token;
    setTimeout(() => { if (this.token === token) App.showResults(); }, 700);
  },

  pause() {
    if (!this.match || this.paused || GK.UI.screen !== "game") return;
    this.paused = true; Input.cancel(); Rumble.off();
    const m = this.match, w = m.where();
    $("pause-where").textContent = m.over ? "Game over." : `${m.players.length > 1 ? m.cur.name + ", f" : "F"}rame ${w.frame + 1} of 10.`;
    GK.UI.openModal("modal-pause");
  },
  resume() {
    GK.UI.closeModal("modal-pause");
    this.paused = false; this.last = 0;
    Input.enabled = !this.ending;
  },
  quit() {
    this.token++;
    GK.UI.closeModal("modal-pause"); GK.UI.closeModal("modal-card");
    this.paused = false; Input.enabled = false; Input.cancel(); Rumble.off();
    clearInterval(this.nudgeTimer);
    this.hideTurn(); $("stamp").className = "stamp";
    this.match = null;
  },
};

// --------------------------------------------------------- title screen --
// The splash plays the real engine with the computer bowling, so the first
// thing anyone sees is the game itself.
const Hero = {
  view: null, lane: null, raf: 0, last: 0, t: 0, wait: 0, ball: 0, rng: Math.random,
  boot() { this.view = new View($("hero")); this.lane = new LaneSim(); this.lane.rack(); },
  start() {
    if (this.raf) return;
    this.view.resize(); this.lane.rack(); this.wait = 0; this.ball = 0; this.view.camU = 0;
    const tick = (t) => { this.raf = requestAnimationFrame(tick); this.frame(t); };
    this.raf = requestAnimationFrame(tick);
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; Fx.reset(); },
  frame(t) {
    if (GK.UI.screen !== "splash") return this.stop();
    let dt = this.last ? (t - this.last) / 1000 : 0; this.last = t;
    dt = Math.max(0, Math.min(0.05, dt));
    this.view.checkSize();
    this.t += dt;
    const L = this.lane, b = L.ball;
    if (b.state === "ready") {
      this.wait += dt;
      if (this.wait > 1.1) {
        const p = Bot.plan(L, "robo", this.rng, {});
        b.x = clampStart(p.x0);
        L.launch(p.x0, p.target, p.power, { power: this.ball === 0 && this.rng() < 0.3 ? "burst" : null });
        this.wait = 0;
      }
    } else if (!L.done) L.tick(dt);
    else {
      this.wait += dt;
      if (this.wait > 1.5) {
        const strike = L.standing().length === 0;
        if (strike || this.ball === 1) { L.rack(); this.ball = 0; } else { L.sweep(); this.ball = 1; }
        this.wait = 0;
      }
    }
    for (const e of L.events) if (e.type === "done" && L.standing().length === 0 && this.ball === 0) Fireworks.show(3, { spread: 0.8 });
    L.events.length = 0;
    this.view.draw({ lane: L, t: this.t, dt, power: b.state !== "ready" ? L.power : null, hold: L.done, home: b.state === "ready" });
  },
};

// -------------------------------------------------------------------- app --
const App = {
  profile: null, party: [], lbTab: "best",

  init() {
    const s = Storage.getSettings();
    Sfx.enabled = s.sound !== false;
    Music.on = s.music !== false;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => { Motion.on = mq.matches ? 0 : 1; document.body.classList.toggle("reduced-motion", mq.matches); };
    applyMotion(); mq.addEventListener ? mq.addEventListener("change", applyMotion) : mq.addListener && mq.addListener(applyMotion);

    GK.UI.onScreenChange = (name) => {
      if (name !== "game") { Input.enabled = false; Input.cancel(); }
      if (name === "splash") { this.refreshSplash(); Hero.start(); } else Hero.stop();
      if (name !== "game" && name !== "results") Fireworks.clear();
      document.body.dataset.screen = name;
    };
    GK.UI.bindSoundToggle(Storage);
    document.querySelectorAll(".btn-sound").forEach((b) => b.addEventListener("click", () => { $("set-sound").checked = Sfx.enabled; if (Sfx.enabled) Music.start(); else Rumble.off(); }));
    GK.UI.bindMenuClicks();
    GK.Profiles.init({
      storage: Storage, avatars: AVATARS,
      meta: (p, prog) => {
        const best = Progress.bestOf(prog), g = (prog.stats || {}).games || 0;
        return g ? `🎳 best ${best} · ${plural(g, "game")}` : "No games yet";
      },
      onEnter: (p) => this.enter(p),
      addLabel: "New Player",
    });
    GK.initPWA({ appName: "Rainbow Bowling" });
    Fireworks.init($("fw"));
    Play.boot(); Hero.boot();
    document.addEventListener("visibilitychange", () => { if (document.hidden) { Play.pause(); Music.stop(); Rumble.off(); } else if (Sfx.ctx) Music.start(); });
    document.addEventListener("pointerdown", () => { Sfx.init(); Music.start(); }, { capture: true });
    $("set-sound").onchange = (e) => { Sfx.enabled = e.target.checked; const st = Storage.getSettings(); st.sound = Sfx.enabled; Storage.saveSettings(st); document.querySelectorAll(".btn-sound").forEach((b) => (b.textContent = Sfx.enabled ? "🔊" : "🔇")); if (Sfx.enabled) Music.start(); else Rumble.off(); };
    $("set-music").onchange = (e) => { const st = Storage.getSettings(); st.music = e.target.checked; Storage.saveSettings(st); Music.setOn(e.target.checked); };
    $("set-fast").onchange = (e) => { const st = Storage.getSettings(); st.fast = e.target.checked; Storage.saveSettings(st); if (Play.match) Play.match.pace = e.target.checked ? 1.8 : 1; };
    $("me-bumpers").onchange = (e) => this.setBumpers(this.party[0], e.target.checked);
    $("guest-form").addEventListener("submit", (e) => { e.preventDefault(); this.addGuest($("guest-name").value); });

    GK.Debug.init({ storage: Storage, title: "RAINBOW BOWLING" })
      .action("give all power-ups", () => { const m = Play.match; if (m) { m.cur.powers = POWER_IDS.slice(0, MAX_POWERS); Play.traySig = ""; } })
      .action("knock all pins next", () => { const m = Play.match; if (m && m.canThrow()) m.throw(m.lane.ball.x, 2.6, 0.75); })
      .action("jump to frame 10", () => { const m = Play.match; if (m) { for (const p of m.players) { p.rolls = [10, 10, 10, 10, 10, 10, 10, 10, 10]; } Play.hudSig = ""; } });

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      $("sync-badge").textContent = ok ? "☁️ Family sync on" : "📴 Playing offline";
      if (!ok) return;
      if (GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (GK.UI.screen === "splash") this.refreshSplash();
      if (GK.UI.screen === "menu") this.showMenu();
      if (GK.UI.screen === "leaderboard") this.showLeaderboard();
    });
  },

  showScreen(n) { GK.UI.showScreen(n); },
  progress(id) { return Storage.getProgress(id || this.profile.id); },

  openSettings(fromPause) {
    this.settingsFromPause = !!fromPause;
    if (fromPause) GK.UI.closeModal("modal-pause");
    const s = Storage.getSettings();
    $("set-sound").checked = Sfx.enabled; $("set-music").checked = s.music !== false; $("set-fast").checked = !!s.fast;
    GK.UI.openModal("modal-settings");
  },
  closeSettings() {
    GK.UI.closeModal("modal-settings");
    if (this.settingsFromPause && Play.match) GK.UI.openModal("modal-pause");
  },
  howTo() { GK.UI.openModal("modal-howto"); },

  // ------------------------------------------------------------ splash --
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = $("btn-continue-as"), start = $("btn-start");
    if (last) {
      cont.hidden = false; cont.textContent = `Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => GK.Profiles.select(last);
      start.className = "btn soft"; start.textContent = "Switch player";
    } else { cont.hidden = true; start.className = "btn big primary"; start.textContent = "Play"; }
  },
  play() { GK.Profiles.renderList(); this.showScreen("profiles"); },

  enter(p) {
    this.profile = p;
    const prog = this.progress(p.id);
    const others = this.party.filter((x) => x.id !== p.id);
    this.party = [{ id: p.id, name: p.name, avatar: p.avatar, bumpers: !!prog.bumpers }].concat(others).slice(0, MAX_PLAYERS);
    this.showMenu();
  },
  setBumpers(pl, on) {
    if (!pl) return;
    pl.bumpers = on;
    if (!pl.guest && !pl.bot) { const pr = this.progress(pl.id); pr.bumpers = on; Storage.saveProgress(pl.id, pr); }
    if (GK.UI.screen === "setup") this.renderParty();
    if (GK.UI.screen === "menu") this.showMenu();
  },

  // -------------------------------------------------------------- menu --
  showMenu() {
    if (!this.profile) return this.play();
    const p = this.progress(), st = p.stats || {};
    $("menu-avatar").textContent = this.profile.avatar;
    $("menu-name").textContent = this.profile.name;
    $("me-bumpers").checked = !!(this.party[0] && this.party[0].bumpers);
    $("me-stats").innerHTML = `
      <span><b>${p.best || "–"}</b><small>Best game</small></span>
      <span><b>${p.bestB || "–"}</b><small>Best with bumpers</small></span>
      <span><b>${st.strikes || 0}</b><small>Strikes</small></span>
      <span><b>${st.games || 0}</b><small>Games</small></span>`;
    this.showScreen("menu");
  },
  me() { return this.party[0] ? { ...this.party[0] } : null; },
  startSolo() { this.lastStart = { mode: "solo", players: [this.me()] }; Play.start(this.lastStart); },

  // ------------------------------------------------------------- setup --
  showSetup() {
    this.renderParty();
    this.showScreen("setup");
    // nobody to play with yet: go straight to picking someone
    if (this.party.length < 2) setTimeout(() => this.openAddPlayer(), 250);
  },
  renderParty() {
    const list = $("party-list"); list.innerHTML = "";
    this.party.forEach((pl, i) => {
      const d = document.createElement("div");
      d.className = "party-chip panel"; d.style.setProperty("--seat", SEATS[i]);
      d.innerHTML = `<i class="seat-dot"></i><span class="pc-name">${esc(pl.avatar)} ${esc(pl.name)}${pl.bot ? "<small>Computer player</small>" : pl.guest ? "<small>Guest</small>" : ""}</span>
        ${pl.bot ? "" : `<button class="pc-bump${pl.bumpers ? " on" : ""}" aria-pressed="${pl.bumpers ? "true" : "false"}" aria-label="Bumpers for ${esc(pl.name)}">Bumpers</button>`}
        ${i ? `<button class="pc-x" aria-label="Remove ${esc(pl.name)}">×</button>` : ""}`;
      const bb = d.querySelector(".pc-bump"); if (bb) bb.onclick = () => this.setBumpers(pl, !pl.bumpers);
      const x = d.querySelector(".pc-x"); if (x) x.onclick = () => { this.party.splice(i, 1); this.renderParty(); };
      list.appendChild(d);
    });
    $("btn-add-player").hidden = this.party.length >= MAX_PLAYERS;
    const go = $("btn-party-go");
    go.textContent = this.party.length < 2 ? "Add another player" : `Let's bowl! · ${this.party.length} players`;
  },
  openAddPlayer() {
    const list = $("add-list"); list.innerHTML = "";
    const inParty = new Set(this.party.map((x) => x.id));
    for (const p of Storage.getProfiles()) {
      if (inParty.has(p.id)) continue;
      const b = document.createElement("button"); b.className = "add-row";
      b.innerHTML = `<span class="ar-av">${p.avatar}</span><span>${esc(p.name)}</span>${p.pin ? '<svg class="i"><use href="#ico-lock"/></svg>' : ""}`;
      const add = () => { const pr = this.progress(p.id); this.party.push({ id: p.id, name: p.name, avatar: p.avatar, bumpers: !!pr.bumpers }); GK.UI.closeModal("modal-add"); this.renderParty(); };
      b.onclick = () => (p.pin ? (GK.UI.closeModal("modal-add"), GK.Profiles.openPin({ title: `${p.avatar} ${esc(p.name)} is locked`, sub: "Enter the 4-digit PIN", mode: "verify", profile: p, onSuccess: add })) : add());
      list.appendChild(b);
    }
    if (!inParty.has("robo")) {
      const r = document.createElement("button"); r.className = "add-row";
      r.innerHTML = `<span class="ar-av">🤖</span><span>Robo-Rolly<small>A computer player to bowl against</small></span>`;
      r.onclick = () => { this.party.push({ ...ROBO, bumpers: false }); GK.UI.closeModal("modal-add"); this.renderParty(); };
      list.appendChild(r);
    }
    $("guest-name").value = "";
    GK.UI.openModal("modal-add");
  },
  addGuest(name) {
    const n = String(name || "").trim().slice(0, 14) || `Guest ${this.party.filter((x) => x.guest).length + 1}`;
    if (this.party.length >= MAX_PLAYERS) return;
    this.party.push({ id: "guest-" + Date.now(), name: n, avatar: "🙂", bumpers: false, guest: true });
    GK.UI.closeModal("modal-add");
    this.renderParty();
  },
  startParty() {
    if (this.party.length < 2) return this.openAddPlayer();
    this.lastStart = { mode: "party", players: this.party.map((x) => ({ ...x })) };
    Play.start(this.lastStart);
  },

  // -------------------------------------------------------- score sheet --
  showCard() {
    const m = Play.match; if (!m) return;
    if (!Play.paused) { Play.paused = true; Input.cancel(); this.cardPaused = true; } else this.cardPaused = false;
    $("mc-title").textContent = m.players.length > 1 ? "Everyone's scores" : "Your score sheet";
    $("mc-card").innerHTML = this.cardHtml(m);
    GK.UI.openModal("modal-card");
  },
  closeCard() {
    GK.UI.closeModal("modal-card");
    if (this.cardPaused) { Play.paused = false; Play.last = 0; }
  },
  cardHtml(m) {
    let h = `<table class="card"><thead><tr><th scope="col"></th>`;
    for (let i = 1; i <= 10; i++) h += `<th scope="col">${i}</th>`;
    h += `<th scope="col">Total</th></tr></thead><tbody>`;
    m.players.forEach((p, seat) => {
      const fr = Scoring.frames(p.rolls);
      h += `<tr><th scope="row"><i class="seat-dot" style="--seat:${SEATS[seat]}"></i>${esc(p.avatar)}<span class="cn">${esc(p.name)}</span></th>`;
      fr.forEach((f, i) => {
        const mk = Scoring.marks(f, i === 9);
        h += `<td><span class="fm">${mk.map((x) => `<i class="${x === "X" ? "x" : x === "/" ? "s" : ""}">${x}</i>`).join("")}</span><span class="fs">${f.score != null ? f.score : ""}</span></td>`;
      });
      h += `<td class="tot">${Scoring.total(p.rolls)}</td></tr>`;
    });
    return h + `</tbody></table>`;
  },

  // -------------------------------------------------------------- results --
  showResults() {
    const m = Play.match; if (!m) return;
    const st = m.standings(), solo = m.players.length === 1, lines = [];
    m.players.forEach((pl, seat) => {
      const total = Scoring.total(pl.rolls), t = Scoring.tally(pl.rolls);
      if (pl.guest || pl.bot) return;
      const pr = this.progress(pl.id);
      const prev = pl.bumpers ? pr.bestB || 0 : pr.best || 0;
      const row = st.find((r) => r.seat === seat);
      Progress.recordGame(pr, {
        score: total, bumpers: !!pl.bumpers, strikes: t.strikes, spares: t.spares, turkey: pl.stats.bestStreak >= 3,
        splits: pl.stats.splits, converted: pl.stats.converted, powers: pl.stats.powersUsed,
        win: !solo && row.place === 1 && st.filter((r) => r.place === 1).length === 1,
      });
      Storage.saveProgress(pl.id, pr);
      if (total > prev && (pl.stats && true)) lines.push(`${solo ? "New personal best" : pl.name + ": new personal best"}${pl.bumpers ? " with bumpers" : ""}!`);
    });
    const tie = !solo && st[0].total === st[1].total;
    const winners = st.filter((r) => r.place === 1);
    $("res-kicker").textContent = solo ? "Ten frames done" : "Game over";
    if (solo) {
      const t = Scoring.tally(m.players[0].rolls), total = st[0].total;
      $("res-title").textContent = total === 300 ? "A PERFECT GAME!" : total >= 200 ? "Amazing bowling!" : total >= 120 ? "Great game!" : total >= 70 ? "Well bowled!" : "Nice game!";
      $("res-big").innerHTML = `<b>${total}</b><span>${plural(t.strikes, "strike")} · ${plural(t.spares, "spare")}</span>`;
    } else {
      $("res-title").textContent = tie ? (winners.length === m.players.length ? "Everyone ties!" : "It's a tie!") : `${st[0].player.name} wins!`;
      $("res-big").innerHTML = `<ol class="standings">${st.map((r) => `<li class="${r.place === 1 ? "win" : ""}"><span class="sd-rank">${r.place === 1 ? "🏆" : r.place}</span><i class="seat-dot" style="--seat:${SEATS[r.seat]}"></i><span class="sd-name">${esc(r.player.avatar)} ${esc(r.player.name)}</span><b>${r.total}</b></li>`).join("")}</ol>`;
    }
    $("res-card").innerHTML = this.cardHtml(m);
    $("res-note").textContent = lines.join(" ") || (solo ? "Bowl again to beat it!" : tie ? "A tie! Everybody gets a cheer." : "What a match!");
    $("res-again").onclick = () => { Play.quit(); Play.start({ ...this.lastStart, players: this.lastStart.players.map((x) => ({ ...x })) }); };
    $("res-menu").onclick = () => { Play.quit(); this.showMenu(); };
    this.showScreen("results");
    Sfx.fanfare();
    Fireworks.show(tie || !solo || st[0].total >= 100 ? 10 : 6, { spread: 2.4, big: true, top: 0.08, bottom: 0.45 });
  },

  restartGame() {
    if (!Play.match) return;
    GK.UI.closeModal("modal-pause");
    const cfg = this.lastStart;
    Play.quit(); Play.start({ ...cfg, players: cfg.players.map((x) => ({ ...x })) });
  },
  exitGame() { Play.quit(); this.showMenu(); },

  // ------------------------------------------------------- leaderboard --
  showLeaderboard() {
    const tabs = [["best", "Best game"], ["bumpers", "With bumpers"], ["strikes", "Strikes"]];
    $("lb-tabs").replaceChildren(...tabs.map(([id, label]) => {
      const b = document.createElement("button");
      b.className = "lb-tab" + (id === this.lbTab ? " active" : ""); b.textContent = label;
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", id === this.lbTab ? "true" : "false");
      b.onclick = () => { this.lbTab = id; this.showLeaderboard(); };
      return b;
    }));
    const tab = this.lbTab;
    const val = (r) => { const p = r.progress || {}; return tab === "best" ? p.best || 0 : tab === "bumpers" ? p.bestB || 0 : (p.stats || {}).strikes || 0; };
    $("lb-note").textContent = tab === "best" ? "Highest ten-frame game, no bumpers." : tab === "bumpers" ? "Highest game with the bumpers up." : "Every strike, in every game, ever.";
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => { const v = val(r); return v ? `<span class="lb-stat"><b>${v}</b></span>` : `<span class="lb-stat dim">${tab === "strikes" ? "None yet" : "No game yet"}</span>`; },
      sort: (a, b) => val(b) - val(a),
      meId: this.profile && this.profile.id,
      empty: "No players yet. Tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();
