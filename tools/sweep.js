// Balance probe: what does a throw knock down?
//   node tools/sweep.js grid      — mean pins / strike % over start x and target
//   node tools/sweep.js bots      — average game per bot skill (50 games each)
//   node tools/sweep.js line x0 target power — one throw, pin by pin
const S = require("../tests/load.js");
const { LaneSim, Match, Bot, SKILLS, mulberry32, Scoring } = S;

function one(x0, target, power, opts) {
  const l = new LaneSim(); l.rack();
  l.launch(x0, target, power, opts || {});
  let n = 0; while (!l.done && n++ < 20000) l.step();
  return { knocked: l.knocked(), left: l.standingNums(), t: l.t, split: l.isSplit() };
}

const mode = process.argv[2] || "grid";
if (mode === "line") {
  const [x0, t, p] = process.argv.slice(3).map(Number);
  console.log(one(x0, t, p));
} else if (mode === "grid") {
  for (const power of (process.argv[3] ? [Number(process.argv[3])] : [0.2, 0.7, 1])) {
    console.log(`\npower ${power}: rows = start x, cols = target x (knocked, * = strike)`);
    const targets = []; for (let t = -12; t <= 12; t += 1) targets.push(t);
    console.log("      " + targets.map((t) => String(t).padStart(4)).join(""));
    for (const x0 of [-12, -6, 0, 4, 8, 12, 15]) {
      let row = String(x0).padStart(5) + " ";
      for (const t of targets) { const r = one(x0, t, power); row += (r.knocked === 10 ? "*" : String(r.knocked)).padStart(4); }
      console.log(row);
    }
  }
} else if (mode === "bots") {
  for (const k of Object.keys(SKILLS)) {
    const rng = mulberry32(42);
    const scores = [], tal = { strikes: 0, spares: 0 };
    for (let g = 0; g < 30; g++) {
      const m = new Match({ players: [{ name: k }], seed: g + 1 });
      m.autoplay(Bot.brain(k, rng, true));
      const r = m.players[0].rolls;
      scores.push(Scoring.total(r));
      const t = Scoring.tally(r); tal.strikes += t.strikes; tal.spares += t.spares;
    }
    scores.sort((a, b) => a - b);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`${k.padEnd(8)} mean ${mean.toFixed(0)}  min ${scores[0]}  median ${scores[15]}  max ${scores[29]}  strikes/game ${(tal.strikes / 30).toFixed(1)}  spares/game ${(tal.spares / 30).toFixed(1)}`);
  }
}
