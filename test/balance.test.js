import test from "node:test";
import assert from "node:assert/strict";

import {
  topUpFactor,
  survivalThreshold,
  trafficWindowBudget,
  trafficCount,
  streakMultiplier,
  UNIT_COST_SECONDS,
  CLOCK_MAX,
  STREAK_CAP,
  CHECKPOINTS_PER_LAP,
} from "../js/sim/config.js";
import { race, median } from "./harness.js";
import { PROFILES } from "./bot.js";

const SEEDS = [1, 2, 3, 4, 5, 6];

// Cached: every test below reads the same sweep, and each run is a few hundred
// thousand simulation steps.
let sweepCache = null;
function sweep() {
  if (sweepCache) return sweepCache;
  sweepCache = {};
  for (const profile of Object.keys(PROFILES)) {
    sweepCache[profile] = SEEDS.map((seed) =>
      race({ profile, seed, botSeed: seed * 13 + 1, maxSeconds: 1200 }),
    );
  }
  return sweepCache;
}

test("difficulty never eases as the run goes on", () => {
  // The threshold is a pure function of progress, so it costs nothing to check
  // far past anything a player will reach. This is what catches a retune that
  // reintroduces a spike.
  let prev = Infinity;
  for (let cp = 0; cp <= 400; cp++) {
    const k = survivalThreshold(cp);
    assert.ok(k <= prev + 1e-12, `threshold rose at checkpoint ${cp}: ${prev} -> ${k}`);
    assert.ok(Number.isFinite(k) && k > 0, `threshold ${k} at ${cp}`);
    prev = k;
  }
  assert.ok(topUpFactor(0) > 1, "the opening checkpoints must bank time");
  // This game is endless, so it has to end: the threshold must fall below 1.
  assert.ok(survivalThreshold(400) < 1, "an endless run that never ends is not a run");
});

test("traffic density never eases either", () => {
  let prevBudget = 0;
  let prevPool = 0;
  for (let cp = 0; cp <= 400; cp++) {
    assert.ok(trafficWindowBudget(cp) >= prevBudget, `density fell at ${cp}`);
    assert.ok(trafficCount(cp) >= prevPool, `pool shrank at ${cp}`);
    prevBudget = trafficWindowBudget(cp);
    prevPool = trafficCount(cp);
  }
});

test("the clock's unit cost matches what a flawless driver actually achieves", () => {
  // The constant is the reference every threshold is expressed against. If the
  // track, the physics or the traffic change and it is not re-measured, every
  // difficulty number silently means something else.
  const times = sweep().flawless.flatMap((r) => r.checkpointTimes.slice(2));
  const actual = median(times);
  const ratio = actual / UNIT_COST_SECONDS;
  assert.ok(
    ratio > 0.9 && ratio < 1.1,
    `flawless pace ${actual.toFixed(2)}s vs UNIT_COST_SECONDS ${UNIT_COST_SECONDS}s (ratio ${ratio.toFixed(3)})`,
  );
});

test("a flawless driver is not punished for driving perfectly", () => {
  // A collision here costs speed rather than the run, so the bar is a rate
  // rather than zero - but a controller with no injected error crashing often
  // means the traffic has become unavoidable, not that the game got hard.
  const runs = sweep().flawless;
  const minutes = runs.reduce((a, r) => a + r.survived, 0) / 60;
  const crashes = runs.reduce((a, r) => a + r.collisions, 0);
  const perMinute = crashes / minutes;
  assert.ok(
    perMinute < 0.25,
    `flawless driver crashed ${crashes} times in ${minutes.toFixed(1)} min (${perMinute.toFixed(2)}/min)`,
  );
});

test("survival falls as driver error rises, and every run ends", () => {
  const order = ["flawless", "expert", "average", "beginner"];
  const results = sweep();
  const survived = order.map((p) => median(results[p].map((r) => r.survived)));

  for (const p of order) {
    assert.ok(
      results[p].every((r) => !r.timedOut),
      `${p} hit the time cap - the clock is not ending runs`,
    );
  }
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      survived[i] < survived[i - 1],
      `${order[i]} (${survived[i].toFixed(0)}s) outlasted ${order[i - 1]} (${survived[i - 1].toFixed(0)}s)`,
    );
  }
  // A flat curve would mean the handicap never reaches the outcome.
  assert.ok(
    survived[0] / survived.at(-1) > 1.5,
    `beginner and flawless are barely distinguishable: ${survived.map((x) => x.toFixed(0))}`,
  );
});

test("the streak multiplier separates skill more sharply than survival does", () => {
  // An affine per-unit reward pays a perfect run barely more than a good one.
  // The compounding term rides on the discretionary part, so the score gap has
  // to come out wider than the run-length gap it is built on.
  const results = sweep();
  const gap = (key) =>
    median(results.flawless.map((r) => r[key])) / median(results.beginner.map((r) => r[key]));
  const survivalGap = gap("survived");
  const scoreGap = gap("score");
  assert.ok(
    scoreGap > survivalGap * 1.3,
    `score gap ${scoreGap.toFixed(2)}x barely beats survival gap ${survivalGap.toFixed(2)}x`,
  );
});

test("the multiplier is bounded and monotone", () => {
  assert.equal(streakMultiplier(0), 1);
  let prev = 0;
  for (let n = 0; n <= 200; n++) {
    const m = streakMultiplier(n);
    assert.ok(m >= prev, `multiplier fell at streak ${n}`);
    prev = m;
  }
  assert.equal(streakMultiplier(STREAK_CAP), streakMultiplier(STREAK_CAP + 500));
});

test("the opening clock is worth a useful number of checkpoints", () => {
  const units = CLOCK_MAX / UNIT_COST_SECONDS;
  assert.ok(units >= 1.5 && units <= 4, `starting clock is ${units.toFixed(2)} checkpoints' worth`);
  assert.ok(CHECKPOINTS_PER_LAP >= 2);
});
