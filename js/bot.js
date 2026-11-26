// One bowler brain, used by the computer player, the title-screen demo and
// the balance tests. It picks a line the way a person does — start right of
// centre and roll into the 1-3 pocket for a full rack; for a spare, start
// on the far side and cross the lane to the front pin that is left — and
// then misses by a believable amount.
//
// Skill is the two numbers a finger on glass actually gets wrong: where the
// ball crosses the head pin (inches) and how hard it was thrown (power).

const SKILLS = {
  kid: { aim: 7, pow: 0.22, label: "a six-year-old" },
  rosalie: { aim: 5, pow: 0.16, label: "an eight-year-old" },
  robo: { aim: 4, pow: 0.12, label: "the computer player" },
  adult: { aim: 2.5, pow: 0.1, label: "a steady adult" },
  pro: { aim: 1.2, pow: 0.05, label: "a sharp adult" },
};

const STRIKE_LINE = { x0: 9, target: 2.9, power: 0.72 };

const Bot = {
  gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },

  // The throw the bot MEANS to make.
  intent(lane) {
    const up = lane.standing();
    if (up.length === 10) return { ...STRIKE_LINE };
    const aim = lane.aimPoint(1);
    // cross the lane: start on the side away from the pins
    const x0 = Math.abs(aim) < 4 ? STRIKE_LINE.x0 * 0.6 : -Math.sign(aim) * 9;
    return { x0, target: aim, power: 0.8 };
  },

  // The throw it actually makes.
  plan(lane, skill, rng, opts) {
    const s = typeof skill === "string" ? SKILLS[skill] : skill;
    const want = this.intent(lane);
    const o = opts || {};
    return {
      x0: want.x0,
      target: want.target + this.gauss(rng) * s.aim,
      power: Math.max(0, Math.min(1, want.power + this.gauss(rng) * s.pow)),
      arm: o.powers && o.powers.length ? o.powers[0] : null,
    };
  },

  // A brain for Match.autoplay: every seat plays at `skill`.
  brain(skill, rng, usePowers) {
    return (m) => this.plan(m.lane, skill, rng, { powers: usePowers ? m.cur.powers : null });
  },
};
