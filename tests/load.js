// Shared loader for the suites and the tools: runs the REAL engine sources in
// a vm sandbox, in index.html order. Nothing that touches the DOM is loaded —
// if the engine ever reaches for it, every suite fails to load.
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
module.exports = loadScripts({
  baseDir: ROOT,
  files: ["js/scoring.js", "js/lane.js", "js/game.js", "js/bot.js", "js/swipe.js"],
  exports: ["Scoring", "LANE", "PIN_DRAG", "PIN_SWING", "PIN_SPOTS", "PIN_NEXT", "POWERS", "POWER_IDS", "LaneSim", "mulberry32", "Match", "Bot", "SKILLS", "MAX_POWERS", "Swipe", "aimPath", "HOOK"],
});
