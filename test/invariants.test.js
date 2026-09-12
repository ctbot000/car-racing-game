import test from "node:test";
import assert from "node:assert/strict";

import { createSim, startSim, stepSim, STATUS } from "../js/sim/sim.js";
import { buildTrack } from "../js/sim/track.js";
import {
  FIXED_STEP,
  COMMIT_DISTANCE,
  SEGMENT_LENGTH,
  LANES,
  RETENTION_BEHIND_BASE,
  RETENTION_SLACK_SECONDS,
  CHECKPOINTS_PER_LAP,
  CLOCK_MAX,
} from "../js/sim/config.js";
import { relativeZ } from "../js/sim/traffic.js";
import { playerWorldZ, PLAYER_X_LIMIT } from "../js/sim/player.js";
import { makeBot } from "./bot.js";

const SECONDS = 240;

/** Run a race, calling `watch` before and after every step. */
function drive(seed, watch, { profile = "average", seconds = SECONDS } = {}) {
  const s = createSim({ seed });
  startSim(s);
  const bot = makeBot(profile, seed * 17 + 5);
  while (s.status === STATUS.RACING && s.elapsed < seconds) {
    const before = watch.before?.(s);
    const events = stepSim(s, bot(s), FIXED_STEP);
    watch.after?.(s, events, before);
  }
  return s;
}

test("the car never ends a step outside the world bounds", () => {
  // Collision resolution displaces the car along a contact normal that knows
  // nothing about the verge, so the clamp has to run again after it. Asserting
  // every step is what pins the ordering against a later refactor.
  for (const seed of [1, 2, 3]) {
    drive(seed, {
      after(s) {
        assert.ok(
          s.playerX >= -PLAYER_X_LIMIT && s.playerX <= PLAYER_X_LIMIT,
          `playerX ${s.playerX} escaped at t=${s.elapsed.toFixed(2)}`,
        );
      },
    });
  }
});

test("no traffic car moves sideways inside the player's reaction window", () => {
  // A hazard still choosing where to be as it closes is unavoidable rather than
  // hard. Lane changes are only started outside DECISION_CUTOFF, which is sized
  // so they always finish before COMMIT_DISTANCE; this is that guarantee.
  for (const seed of [1, 2, 3]) {
    const seen = new Map();
    let checked = 0;
    drive(seed, {
      after(s) {
        const pz = playerWorldZ(s);
        for (let i = 0; i < s.traffic.length; i++) {
          const car = s.traffic[i];
          const key = `${i}:${car.gen}`;
          if (!car.active) {
            seen.delete(key);
            continue;
          }
          const rel = relativeZ(car, pz, s.track.trackLength);
          const prev = seen.get(key);
          if (prev !== undefined && Math.abs(rel) <= COMMIT_DISTANCE) {
            checked++;
            assert.equal(
              car.offset,
              prev,
              `car ${key} drifted ${prev} -> ${car.offset} at rel=${rel.toFixed(0)}`,
            );
          }
          seen.set(key, car.offset);
        }
      },
    });
    assert.ok(checked > 5000, `only ${checked} in-window samples on seed ${seed}`);
  }
});

test("a full-width block of traffic stays rare", () => {
  // It cannot be forbidden outright: cars are spaced when they are placed, but
  // they change lanes and drift together afterwards, and breaking a block up
  // is only legal outside the commit window. What matters is that it stays an
  // occasional squeeze rather than the texture of the game.
  const ABREAST = SEGMENT_LENGTH * 8;
  let walled = 0;
  let steps = 0;
  for (const seed of [1, 2, 3]) {
    drive(
      seed,
      {
        after(s) {
          steps++;
          const cars = s.traffic.filter((c) => c.active).sort((a, b) => a.z - b.z);
          for (let i = 0; i < cars.length; i++) {
            const lanes = new Set([cars[i].lane]);
            for (let j = i + 1; j < cars.length; j++) {
              if (Math.abs(relativeZ(cars[j], cars[i].z, s.track.trackLength)) >= ABREAST) break;
              lanes.add(cars[j].lane);
            }
            if (lanes.size >= LANES) {
              walled++;
              return;
            }
          }
        },
      },
      { profile: "flawless", seconds: 300 },
    );
  }
  const rate = walled / steps;
  assert.ok(steps > 20000, `only ${steps} steps sampled`);
  assert.ok(rate < 0.06, `road fully blocked ${(rate * 100).toFixed(1)}% of steps`);
});

test("cars are retained by time, not by a fixed distance", () => {
  for (const seed of [1, 2]) {
    drive(seed, {
      after(s) {
        const pz = playerWorldZ(s);
        const behind = RETENTION_BEHIND_BASE + s.retentionSpeed * RETENTION_SLACK_SECONDS;
        for (const car of s.traffic) {
          if (!car.active) continue;
          const rel = relativeZ(car, pz, s.track.trackLength);
          // One step of slack: the window is evaluated before the car moves.
          assert.ok(
            rel >= -(behind + s.speed * FIXED_STEP + 1),
            `stale car ${rel.toFixed(0)} behind, window ${behind.toFixed(0)}`,
          );
        }
      },
    });
  }
});

test("no state value ever becomes non-finite", () => {
  // One NaN anywhere turns a derived step count into a silent no-op while every
  // `!== 0` liveness check still reports the car as moving.
  const s = drive(4, {
    after(sim) {
      for (const key of ["position", "playerX", "speed", "clock", "score", "totalDistance"]) {
        assert.ok(Number.isFinite(sim[key]), `${key} became ${sim[key]}`);
      }
      for (const car of sim.traffic) {
        assert.ok(Number.isFinite(car.z) && Number.isFinite(car.offset));
      }
    },
  });
  assert.ok(s.totalDistance > 0);
});

test("the circuit closes: elevation is continuous across the start line", () => {
  const track = buildTrack(1);
  assert.equal(track.segments[0].p1.world.y, 0);
  assert.equal(track.segments.at(-1).p2.world.y, 0);
  // And every segment joins the next one exactly.
  for (let i = 0; i < track.segments.length - 1; i++) {
    assert.equal(track.segments[i].p2.world.y, track.segments[i + 1].p1.world.y);
  }
  assert.equal(track.checkpoints.length, CHECKPOINTS_PER_LAP);
});

test("each checkpoint fires exactly once per lap, and tops the clock up", () => {
  const s = createSim({ seed: 9 });
  startSim(s);
  const bot = makeBot("flawless", 3);
  const hits = new Map();
  let laps = 0;
  while (s.status === STATUS.RACING && s.elapsed < 200) {
    const before = s.clock;
    const events = stepSim(s, bot(s), FIXED_STEP);
    for (const e of events) {
      if (e.type === "checkpoint") {
        hits.set(e.index, (hits.get(e.index) ?? 0) + 1);
        assert.ok(e.gained > 0, "a checkpoint must add time");
        assert.ok(s.clock > before, "the clock must visibly jump on a checkpoint");
        assert.ok(s.clock <= CLOCK_MAX + 1e-9, "the buffer is a cap");
      }
      if (e.type === "lap") laps++;
    }
  }
  assert.ok(laps >= 2, `expected several laps, got ${laps}`);
  const counts = [...hits.values()];
  assert.equal(hits.size, CHECKPOINTS_PER_LAP);
  // Every checkpoint is crossed the same number of times, give or take the
  // partial lap the run ended on.
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `uneven crossings: ${counts}`);
});
