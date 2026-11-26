// Ten-pin scoring, the real rules. One player's game is just the list of pins
// each ball knocked down; everything else (frames, marks, running totals,
// where the next ball comes from, whether the rack is fresh) is derived from
// that list, so it can never disagree with itself. Pure: no DOM, no state.

const Scoring = {
  // Split a roll list into frames: [{ rolls: [..], score: cumulative|null }].
  // score is null until the bonus balls a strike or spare is waiting on exist.
  frames(rolls) {
    const out = [];
    let i = 0, run = 0;
    for (let f = 0; f < 10; f++) {
      if (i >= rolls.length) { out.push({ rolls: [], score: null }); continue; }
      let fr, need;
      if (f < 9) {
        if (rolls[i] === 10) { fr = [10]; need = [rolls[i + 1], rolls[i + 2]]; i += 1; }
        else {
          fr = rolls.slice(i, i + 2);
          need = fr.length === 2 && fr[0] + fr[1] === 10 ? [rolls[i + 2]] : [];
          i += fr.length;
        }
      } else {
        fr = rolls.slice(i, i + 3);
        const a = fr[0], b = fr[1];
        const len = a === 10 || (b != null && a + b === 10) ? 3 : 2;
        fr = fr.slice(0, len);
        need = [];
        i += fr.length;
      }
      const complete = f < 9 ? (fr[0] === 10 || fr.length === 2) : this.tenthDone(fr);
      if (complete && need.every((v) => v != null)) {
        run += fr.reduce((s, v) => s + v, 0) + need.reduce((s, v) => s + v, 0);
        // a running total is only shown when every earlier frame has one too
        const prevOk = f === 0 || out[f - 1].score != null;
        out.push({ rolls: fr, score: prevOk ? run : null });
      } else out.push({ rolls: fr, score: null });
    }
    return out;
  },

  tenthDone(fr) {
    if (fr.length === 3) return true;
    if (fr.length === 2 && fr[0] !== 10 && fr[0] + fr[1] < 10) return true;
    return false;
  },

  // Points banked so far, counting strike/spare bonuses only once they exist,
  // so the number never goes DOWN as more balls arrive.
  total(rolls) {
    const fr = this.frames(rolls);
    let t = 0;
    for (const f of fr) if (f.score != null) t = f.score;
    return t;
  },

  // The same, but with pending bonuses counted as zero — what you would have
  // if you stopped right now. Used for "who's ahead" mid-game.
  sofar(rolls) {
    const fr = this.frames(rolls);
    let t = 0;
    for (let f = 0; f < 10; f++) {
      const x = fr[f];
      if (!x.rolls.length) break;
      t += x.rolls.reduce((s, v) => s + v, 0);
    }
    // add bonuses that already exist
    let i = 0;
    for (let f = 0; f < 9 && i < rolls.length; f++) {
      if (rolls[i] === 10) { t += (rolls[i + 1] || 0) + (rolls[i + 2] || 0); i += 1; }
      else {
        if (i + 1 < rolls.length && rolls[i] + rolls[i + 1] === 10) t += rolls[i + 2] || 0;
        i += 2;
      }
    }
    return t;
  },

  // Where the next ball comes from: { frame 0..9, ball 0..2, standing, fresh, done }
  // `standing` is how many pins should be up; `fresh` means a full new rack.
  next(rolls) {
    let i = 0;
    for (let f = 0; f < 9; f++) {
      if (i >= rolls.length) return { frame: f, ball: 0, standing: 10, fresh: true, done: false };
      if (rolls[i] === 10) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { frame: f, ball: 1, standing: 10 - rolls[i], fresh: false, done: false };
      i += 2;
    }
    const t = rolls.slice(i);
    const [a, b] = t;
    if (t.length === 0) return { frame: 9, ball: 0, standing: 10, fresh: true, done: false };
    if (t.length === 1) return a === 10 ? { frame: 9, ball: 1, standing: 10, fresh: true, done: false } : { frame: 9, ball: 1, standing: 10 - a, fresh: false, done: false };
    if (t.length === 2) {
      if (a !== 10 && a + b < 10) return { frame: 9, ball: 2, standing: 0, fresh: false, done: true };
      if (a === 10 && b === 10) return { frame: 9, ball: 2, standing: 10, fresh: true, done: false };
      if (a === 10) return { frame: 9, ball: 2, standing: 10 - b, fresh: false, done: false };
      return { frame: 9, ball: 2, standing: 10, fresh: true, done: false };   // spare
    }
    return { frame: 9, ball: 3, standing: 0, fresh: false, done: true };
  },

  done(rolls) { return this.next(rolls).done; },

  // The marks a score sheet shows for one frame: "X", "/", "-", digits.
  marks(fr, tenth) {
    const r = fr.rolls, m = [];
    if (!tenth) {
      if (r[0] === 10) return ["", "X"];
      if (r.length > 0) m.push(r[0] === 0 ? "-" : String(r[0]));
      if (r.length > 1) m.push(r[0] + r[1] === 10 ? "/" : r[1] === 0 ? "-" : String(r[1]));
      return m;
    }
    // tenth frame: a mark is X when it knocks a full rack, / when it finishes one
    let up = 10, fresh = true;
    for (let k = 0; k < r.length; k++) {
      const v = r[k];
      if (fresh && v === 10) { m.push("X"); continue; }
      if (!fresh && v === up) { m.push("/"); up = 10; fresh = true; continue; }
      m.push(v === 0 ? "-" : String(v));
      if (fresh) { up = 10 - v; fresh = false; } else { up = 10; fresh = true; }
    }
    return m;
  },

  // Count the marks in a finished roll list (for stats).
  tally(rolls) {
    const fr = this.frames(rolls);
    let strikes = 0, spares = 0, gutters = 0, best = 0, run = 0;
    fr.forEach((f, idx) => {
      const mk = this.marks(f, idx === 9);
      for (const x of mk) {
        if (x === "X") { strikes++; run++; best = Math.max(best, run); }
        else if (x === "/") { spares++; run = 0; }
        else if (x !== "") run = 0;
      }
    });
    for (const v of rolls) if (v === 0) gutters++;
    return { strikes, spares, zeros: gutters, bestRun: best };
  },
};
