const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const S = loadScripts({
  baseDir: path.join(__dirname, ".."),
  files: ["lib/gk-util.js", "lib/gk-storage.js", "js/storage.js"],
  exports: ["PROGRESS", "Progress", "STAT_KEYS"],
  browser: true,
});
const { PROGRESS, Progress } = S;
const plain = (o) => JSON.parse(JSON.stringify(o));

test("merge keeps the best of everything, both ways round", () => {
  const a = { best: 120, bestB: 0, stats: { games: 4, strikes: 9 }, bumpers: true, updated: 10 };
  const b = { best: 98, bestB: 140, stats: { games: 6, strikes: 7, spares: 3 }, bumpers: false, updated: 20 };
  const ab = plain(PROGRESS.merge(a, b)), ba = plain(PROGRESS.merge(b, a));
  assert.deepEqual(ab, ba);
  assert.equal(ab.best, 120);
  assert.equal(ab.bestB, 140);
  assert.deepEqual(ab.stats, { games: 6, strikes: 9, spares: 3 });
  assert.equal(ab.bumpers, false, "the newer device's bumper choice wins");
  assert.equal(ab.updated, 20);
});

test("merging with a blank changes nothing", () => {
  const a = { best: 77, bestB: 101, stats: { games: 2 }, bumpers: true, updated: 5 };
  const m = plain(PROGRESS.merge(PROGRESS.blank(), a));
  assert.equal(m.best, 77); assert.equal(m.bestB, 101); assert.equal(m.bumpers, true);
});

test("recordGame files a score under the right best and counts things up", () => {
  const p = PROGRESS.blank();
  Progress.recordGame(p, { score: 130, bumpers: true, strikes: 3, spares: 4, turkey: false, splits: 1, converted: 0, powers: 2, win: true });
  Progress.recordGame(p, { score: 90, bumpers: false, strikes: 1, spares: 2, turkey: false, splits: 0, converted: 0, powers: 0 });
  Progress.recordGame(p, { score: 300, bumpers: false, strikes: 12, spares: 0, turkey: true, splits: 0, converted: 0, powers: 0 });
  assert.equal(p.bestB, 130);
  assert.equal(p.best, 300);
  assert.equal(p.stats.games, 3);
  assert.equal(p.stats.strikes, 16);
  assert.equal(p.stats.perfect, 1);
  assert.equal(p.stats.turkeys, 1);
  assert.equal(p.stats.wins, 1);
  assert.equal(Progress.bestOf(p), 300);
});
