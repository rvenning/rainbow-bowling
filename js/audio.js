// Sounds and music, layered on gamekit's synth. Everything is generated:
// nothing to load, nothing copyrighted, works offline.
//
// The ball's rumble is one long-lived voice (a looped noise buffer through a
// low-pass) built once and turned up and down — never rebuilt per throw, so
// nothing leaks on iPad. Pins clack like maple, a strike crashes, a spare is
// always something silly, and nothing ever buzzes: a gutter ball is a soft
// "wah-wah".

const Sfx = GK.Sfx;
const MUSIC_VOL = 0.5;

const Rumble = {
  src: null, gain: null, filter: null,
  ensure() {
    const ctx = Sfx.ctx;
    if (this.src || !ctx) return !!this.src;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    this.src = ctx.createBufferSource(); this.src.buffer = buf; this.src.loop = true;
    this.filter = ctx.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = 260;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.filter); this.filter.connect(this.gain); this.gain.connect(ctx.destination);
    this.src.start();
    return true;
  },
  // level 0..1 (ball speed), deck = on the wooden pin deck (brighter)
  set(level, deck) {
    if (!Sfx.ctx || !this.ensure()) return;
    const t = Sfx.ctx.currentTime, v = Sfx.enabled ? Math.max(0, Math.min(1, level)) * 0.5 : 0;
    this.gain.gain.setTargetAtTime(v, t, 0.06);
    this.filter.frequency.setTargetAtTime(deck ? 520 : 200 + level * 120, t, 0.1);
  },
  off() { if (this.gain && Sfx.ctx) this.gain.gain.setTargetAtTime(0, Sfx.ctx.currentTime, 0.05); },
};

const SILLY = ["slide", "boing", "honk", "kazoo"];
let sillyIdx = 0;

Object.assign(Sfx, {
  release(pow) { this.tone({ freq: 90, type: "sine", dur: 0.18, vol: 0.22, slide: -30 }); this.noise({ dur: 0.06, vol: 0.06 + pow * 0.05 }); },
  // one pin struck: a hollow wooden knock, pitched a little per pin
  pin(v, n) {
    const k = Math.min(1, v / 320), f = 520 + ((n * 137) % 7) * 45;
    this.tone({ freq: f, type: "triangle", dur: 0.07, vol: 0.06 + k * 0.14 });
    this.tone({ freq: f * 2.7, type: "sine", dur: 0.04, vol: 0.03 + k * 0.05 });
    this.noise({ dur: 0.035, vol: 0.04 + k * 0.08 });
  },
  clack(v, n) { const k = Math.min(1, v / 250); this.tone({ freq: 700 + ((n * 91) % 5) * 60, type: "triangle", dur: 0.05, vol: 0.03 + k * 0.08 }); this.noise({ dur: 0.02, vol: 0.02 + k * 0.04 }); },
  kick(v) { const k = Math.min(1, v / 300); this.tone({ freq: 160, type: "square", dur: 0.06, vol: 0.03 + k * 0.05 }); this.noise({ dur: 0.05, vol: 0.04 + k * 0.05 }); },
  crash() { this.noise({ dur: 0.45, vol: 0.2 }); [300, 410, 530, 650].forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.12, vol: 0.08, when: i * 0.03 })); },
  gutter() { this.tone({ freq: 140, type: "sine", dur: 0.25, vol: 0.12, slide: -50 }); this.noise({ dur: 0.18, vol: 0.04 }); },
  bumper() { this.tone({ freq: 330, type: "sine", dur: 0.12, vol: 0.1, slide: 260 }); this.tone({ freq: 500, type: "triangle", dur: 0.08, vol: 0.05, when: 0.03, slide: 200 }); },
  pit() { this.tone({ freq: 70, type: "sine", dur: 0.22, vol: 0.18, slide: -20 }); },

  strike() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone({ freq: 523 * Math.pow(2, s / 12), type: "triangle", dur: 0.18, vol: 0.12, when: 0.15 + i * 0.07 }));
    [0, 7, 12].forEach((s, i) => this.tone({ freq: 262 * Math.pow(2, s / 12), type: "sine", dur: 0.5, vol: 0.09, when: 0.15 + i * 0.2 }));
  },
  turkey() { [0, 4, 7, 12, 7, 12, 16, 19, 24, 19, 24, 28].forEach((s, i) => this.tone({ freq: 392 * Math.pow(2, s / 12), type: "square", dur: 0.12, vol: 0.05, when: 0.9 + i * 0.08 })); },

  // A spare is always something silly — and a different silly each time.
  silly() {
    const which = SILLY[sillyIdx++ % SILLY.length];
    this[which]();
    return which;
  },
  slide() {   // slide whistle up and back down
    this.tone({ freq: 500, type: "sine", dur: 0.38, vol: 0.13, slide: 900 });
    this.tone({ freq: 1400, type: "sine", dur: 0.34, vol: 0.12, when: 0.36, slide: -1000 });
  },
  boing() {   // a wobbly spring, twice
    for (let i = 0; i < 2; i++) for (let k = 0; k < 6; k++) this.tone({ freq: 200 + (k % 2 ? 90 : 0) + i * 60, type: "sine", dur: 0.06, vol: 0.13 - k * 0.015, when: i * 0.34 + k * 0.045, slide: 120 });
  },
  honk() {    // clown horn: honk-honk
    for (let i = 0; i < 2; i++) { this.tone({ freq: 330, type: "square", dur: 0.16, vol: 0.07, when: i * 0.24, slide: -30 }); this.tone({ freq: 415, type: "sawtooth", dur: 0.16, vol: 0.04, when: i * 0.24, slide: -30 }); }
  },
  kazoo() {   // a buzzy "wah-hoo!"
    this.tone({ freq: 260, type: "sawtooth", dur: 0.22, vol: 0.06, slide: -40 });
    this.tone({ freq: 330, type: "sawtooth", dur: 0.36, vol: 0.06, when: 0.22, slide: 260 });
    this.tone({ freq: 660, type: "square", dur: 0.05, vol: 0.03, when: 0.5 });
  },

  wahwah() { this.tone({ freq: 330, type: "triangle", dur: 0.3, vol: 0.09, slide: -40 }); this.tone({ freq: 294, type: "triangle", dur: 0.5, vol: 0.08, when: 0.32, slide: -60 }); },
  split() { this.tone({ freq: 523, type: "sine", dur: 0.14, vol: 0.09 }); this.tone({ freq: 392, type: "sine", dur: 0.22, vol: 0.09, when: 0.16 }); },
  converted() { [0, 7, 12, 19].forEach((s, i) => this.tone({ freq: 659 * Math.pow(2, s / 12), type: "triangle", dur: 0.12, vol: 0.1, when: 0.5 + i * 0.06 })); },
  power() { [0, 4, 7, 11, 14, 19].forEach((s, i) => this.tone({ freq: 784 * Math.pow(2, s / 12), type: "sine", dur: 0.16, vol: 0.08, when: 0.9 + i * 0.06 })); },
  arm(on) { if (on) { this.tone({ freq: 880, type: "sine", dur: 0.18, vol: 0.08, slide: 500 }); this.tone({ freq: 1320, type: "triangle", dur: 0.12, vol: 0.05, when: 0.06 }); } else this.tone({ freq: 700, type: "sine", dur: 0.12, vol: 0.06, slide: -300 }); },
  burst() { for (let i = 0; i < 8; i++) this.tone({ freq: 1200 + i * 180, type: "sine", dur: 0.08, vol: 0.07, when: i * 0.035 }); this.noise({ dur: 0.2, vol: 0.06 }); },
  turn() { this.tone({ freq: 880, type: "sine", dur: 0.08, vol: 0.06 }); this.tone({ freq: 1175, type: "sine", dur: 0.12, vol: 0.06, when: 0.08 }); },
  aimTick(pow) { this.tone({ freq: 300 + pow * 900, type: "sine", dur: 0.02, vol: 0.025 }); },
  nudge() { this.tone({ freq: 620, type: "triangle", dur: 0.03, vol: 0.04 }); },
  rack() { for (let i = 0; i < 4; i++) this.tone({ freq: 900 + i * 40, type: "triangle", dur: 0.03, vol: 0.03, when: i * 0.04 }); },
  // fireworks
  whistle(d) { this.tone({ freq: 600, type: "sine", dur: d || 0.5, vol: 0.035, slide: 900 }); },
  boom() { this.noise({ dur: 0.35, vol: 0.12 }); this.tone({ freq: 90, type: "sine", dur: 0.3, vol: 0.14, slide: -40 }); },
  crackle() { for (let i = 0; i < 6; i++) this.noise({ dur: 0.02, vol: 0.04, when: 0.15 + i * 0.05 + (i % 2) * 0.02 }); },
  fanfare() { [0, 4, 7, 12, 16, 12, 16, 19, 24].forEach((s, i) => this.tone({ freq: 392 * Math.pow(2, s / 12), type: "triangle", dur: 0.22, vol: 0.13, when: i * 0.11 })); },
});

// ------------------------------------------------------------------ music --
// A little roller-disco loop: a root, a tempo, a four-chord cycle and a
// 16-step lead per chord written as degrees of a major pentatonic. Played by
// a lookahead pump on the WebAudio clock so it never drifts.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const TRACK = {
  root: 294, bpm: 112, lead: "triangle", leadVol: 0.045, bass: "sine", bassVol: 0.08,
  chords: [0, 5, 9, 7],
  pat: [
    [4, null, 5, 4, null, 2, null, 3, 4, null, 5, null, 7, null, null, null],
    [5, null, 4, null, 2, null, 4, 5, null, 4, 2, null, 1, null, null, null],
  ],
};

const Music = {
  on: true, timer: 0, nextT: 0, step: 0,
  start() {
    if (!this.on || this.timer || !Sfx.ctx) return;
    this.nextT = Sfx.ctx.currentTime + 0.1; this.step = 0;
    this.timer = setInterval(() => this.pump(), 110);
  },
  stop() { clearInterval(this.timer); this.timer = 0; },
  setOn(v) { this.on = v; if (v) this.start(); else this.stop(); },
  pump() {
    const ctx = Sfx.ctx;
    if (!ctx || !Sfx.enabled) return;
    const tr = TRACK, spb = 60 / tr.bpm / 2;
    if (this.nextT < ctx.currentTime - 0.3) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < ctx.currentTime + 0.6) {
      const bar = Math.floor(this.step / 16) % tr.chords.length, s = this.step % 16;
      const chord = tr.chords[bar], pat = tr.pat[bar % tr.pat.length], when = this.nextT - ctx.currentTime;
      const deg = pat[s];
      if (deg != null) Sfx.tone({ freq: tr.root * Math.pow(2, (chord + PENTA[deg]) / 12), type: tr.lead, dur: spb * 1.4, vol: tr.leadVol * MUSIC_VOL, when });
      // disco octave bass on every eighth
      if (s % 2 === 0) Sfx.tone({ freq: (tr.root / 4) * Math.pow(2, (chord + (s % 4 === 2 ? 12 : 0)) / 12), type: tr.bass, dur: spb * 0.9, vol: tr.bassVol * MUSIC_VOL, when });
      // a soft hat on the off-beats
      if (s % 4 === 2) Sfx.noise({ dur: 0.02, vol: 0.012 * MUSIC_VOL * 2, when });
      this.nextT += spb; this.step++;
    }
  },
};
