// Persistence — gamekit storage configured for Rainbow Bowling.
// rbowl_* localStorage keys, "rainbowbowling" Firestore collection.
//
// Every saved number only ever grows (best scores, lifetime counts), so the
// merge is field-wise max(). Best games are kept twice: with bumpers and
// without, because a bumper game is a different game. The bumpers CHOICE is
// a setting, not a record, so the side saved more recently wins it.
// blank/merge are named so tests/storage.test.js can call the merge.

const STAT_KEYS = ["games", "strikes", "spares", "turkeys", "splits", "converted", "perfect", "nines", "powers", "wins"];

const PROGRESS = {
  blank: () => ({
    best: 0,            // best game without bumpers
    bestB: 0,           // best game with bumpers
    stats: {},          // lifetime counters, STAT_KEYS
    bumpers: null,      // this player's bumpers choice (null = never chosen)
    updated: 0,
  }),

  merge: (a, b) => {
    const stats = { ...(a.stats || {}) };
    for (const [k, v] of Object.entries(b.stats || {})) stats[k] = Math.max(stats[k] || 0, v || 0);
    const newer = (b.updated || 0) >= (a.updated || 0) ? b : a;
    const older = newer === b ? a : b;
    return {
      ...a, ...b,
      best: Math.max(a.best || 0, b.best || 0),
      bestB: Math.max(a.bestB || 0, b.bestB || 0),
      stats,
      bumpers: newer.bumpers != null ? newer.bumpers : older.bumpers != null ? older.bumpers : null,
      updated: Math.max(a.updated || 0, b.updated || 0),
    };
  },
};

// Fold one finished game into a player's progress (returns it).
const Progress = {
  recordGame(p, g) {
    p.stats = p.stats || {};
    const s = p.stats, add = (k, n) => { s[k] = (s[k] || 0) + (n || 0); };
    if (g.bumpers) p.bestB = Math.max(p.bestB || 0, g.score);
    else p.best = Math.max(p.best || 0, g.score);
    add("games", 1);
    add("strikes", g.strikes); add("spares", g.spares);
    add("turkeys", g.turkey ? 1 : 0);
    add("splits", g.splits); add("converted", g.converted);
    add("powers", g.powers);
    if (g.score === 300) add("perfect", 1);
    if (g.win) add("wins", 1);
    return p;
  },
  // The best that counts on the main leaderboard is the no-bumpers one.
  bestOf(p) { return Math.max(p.best || 0, p.bestB || 0); },
};

const Storage = GK.createStorage({
  prefix: "rbowl",
  collection: "rainbowbowling",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});
