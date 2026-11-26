// A match: one to four players taking turns on one lane, ten frames each.
// It owns the turn order, the rack, the power-up trays and the pace of the
// game (how long a result is shown, when the sweep comes down). DOM-free, and
// every random draw comes from the match's own seed, so a bot game replays.
//
// Phases: "aim" -> "rolling" -> "result" -> "sweep" -> "aim" ... -> "over".
// The app reads `events` each frame and turns them into sound and light.

const MAX_POWERS = 3;
const HOLD = { plain: 1.15, spare: 1.6, strike: 2.3, last: 1.8 };
const SWEEP_T = 0.95;          // the sweep bar's whole trip
const SWEEP_MID = 0.45;        // the moment it clears the deck

class Match {
  // cfg: { players: [{ id, name, avatar, guest, bot, bumpers }], seed }
  constructor(cfg) {
    this.seed = (cfg.seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    this.players = cfg.players.map((p) => ({
      ...p, rolls: [], powers: [], armed: null, streak: 0,
      stats: { splits: 0, converted: 0, powersUsed: 0, bestStreak: 0, gutters: 0 },
    }));
    this.lane = new LaneSim();
    this.lane.rack();
    this.seat = 0;
    this.phase = "aim"; this.phaseT = 0; this.hold = 0; this.pace = cfg.pace || 1;
    this.events = [];
    this.bag = [];
    this.over = false;
    this.last = null;           // the last roll's result, for the HUD
    this.rackT = 0;             // seconds since the pins were last set (for the drop-in)
    this.lastFresh = true;
    this.wasSplit = false;
  }

  get cur() { return this.players[this.seat]; }
  where(p) { return Scoring.next((p || this.cur).rolls); }
  canThrow() { return this.phase === "aim" && !this.over && this.rackT > 0.35; }

  // Tap a power-up in the tray to get it ready for this throw (tap again to put it back).
  arm(id) {
    const p = this.cur;
    if (this.phase !== "aim" || !p.powers.includes(id)) return false;
    p.armed = p.armed === id ? null : id;
    this.events.push({ type: "arm", seat: this.seat, id: p.armed });
    return true;
  }

  throw(x0, target, power) {
    if (!this.canThrow()) return false;
    const p = this.cur, w = this.where();
    const used = p.armed;
    if (used) { p.powers.splice(p.powers.indexOf(used), 1); p.armed = null; p.stats.powersUsed++; }
    this.wasSplit = w.ball > 0 && !this.lastFresh ? this.wasSplit : false;
    this.lane.launch(x0, target, power, { bumpers: !!p.bumpers, power: used });
    this.phase = "rolling"; this.phaseT = 0;
    this.events.push({ type: "throw", seat: this.seat, power: used, frame: w.frame, ball: w.ball });
    return true;
  }

  tick(dt) {
    if (!(dt > 0) || this.over) return;
    // `pace` > 1 shortens only the pauses between balls, never the roll itself
    this.phaseT += this.phase === "result" || this.phase === "sweep" ? dt * this.pace : dt;
    this.rackT += dt;
    if (this.phase === "rolling") {
      this.lane.tick(dt);
      for (const e of this.lane.events) this.events.push(e);
      this.lane.events.length = 0;
      if (this.lane.done) this.finishRoll();
    } else if (this.phase === "result") {
      if (this.phaseT >= this.hold) {
        if (this.gameDone()) { this.phase = "over"; this.over = true; this.events.push({ type: "over" }); }
        else { this.phase = "sweep"; this.phaseT = 0; this.swept = false; this.events.push({ type: "sweep" }); }
      }
    } else if (this.phase === "sweep") {
      if (!this.swept && this.phaseT >= SWEEP_MID) { this.swept = true; this.advance(); }
      if (this.phaseT >= SWEEP_T) { this.phase = "aim"; this.phaseT = 0; this.events.push({ type: "ready", seat: this.seat }); }
    }
  }

  finishRoll() {
    const p = this.cur, before = this.where(), lane = this.lane;
    const n = lane.knocked();
    const fullRack = lane.standingAtLaunch === 10;
    const allDown = lane.standing().length === 0;
    p.rolls.push(n);
    const strike = fullRack && allDown;
    const spare = !fullRack && allDown;
    const gutter = n === 0 && lane.ball.gutterSide !== 0;
    if (gutter) p.stats.gutters++;
    const split = fullRack && !allDown && lane.isSplit();
    if (split) { p.stats.splits++; this.wasSplit = true; }
    const converted = spare && this.wasSplit;
    if (converted) p.stats.converted++;
    if (strike) { p.streak++; p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak); }
    else p.streak = 0;
    let award = null;
    if (allDown) {
      award = this.draw();
      if (p.powers.length < MAX_POWERS) p.powers.push(award); else award = null;
    }
    const after = this.where();
    const last = this.gameDone();
    this.last = { seat: this.seat, knocked: n, strike, spare, gutter, split, converted, award, frame: before.frame, ball: before.ball, streak: p.streak, standing: lane.standingNums() };
    this.events.push(Object.assign({ type: "roll" }, this.last));
    this.phase = "result"; this.phaseT = 0;
    this.hold = strike ? HOLD.strike : spare ? HOLD.spare : last ? HOLD.last : HOLD.plain;
    this.turnEnds = after.done || after.frame !== before.frame;
  }

  // Shuffled bag: every power-up comes up once before any repeats.
  draw() {
    if (!this.bag.length) {
      this.bag = POWER_IDS.slice();
      for (let i = this.bag.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
    }
    return this.bag.pop();
  }

  // Set up the next ball: same player again, or the next player's frame.
  advance() {
    if (this.turnEnds) {
      const prev = this.seat;
      this.seat = (this.seat + 1) % this.players.length;
      this.lane.rack(); this.lastFresh = true; this.rackT = 0; this.wasSplit = false;
      this.events.push({ type: "turn", seat: this.seat, from: prev, changed: prev !== this.seat, frame: this.where().frame });
    } else {
      const w = this.where();
      if (w.fresh) { this.lane.rack(); this.rackT = 0; this.lastFresh = true; this.wasSplit = false; }
      else { this.lane.sweep(); this.lastFresh = false; }
      this.events.push({ type: "rack", fresh: w.fresh });
    }
  }

  gameDone() { return this.players.every((p) => Scoring.done(p.rolls)); }

  // Standings, highest first. Ties share a place.
  standings() {
    const rows = this.players.map((p, seat) => ({ player: p, seat, total: Scoring.total(p.rolls) }));
    rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
    rows.forEach((r, i) => { r.place = i && r.total === rows[i - 1].total ? rows[i - 1].place : i + 1; });
    return rows;
  }

  // Play everything to the end at a fixed step, letting `brain(match)` pick
  // each throw. Used by the tests and the balance tools.
  autoplay(brain, maxSteps) {
    const dt = 1 / 60;
    let n = 0;
    while (!this.over && n++ < (maxSteps || 400000)) {
      if (this.phase === "aim" && this.canThrow()) {
        const t = brain(this);
        if (t.arm) this.arm(t.arm);
        this.throw(t.x0, t.target, t.power);
      }
      this.tick(dt);
      this.events.length = 0;
    }
    return this;
  }
}
