// The simulation: one object holding the whole race, stepped at a fixed rate.
// It touches no DOM, so the browser build and the headless balance tests run
// the exact same code and a failing run replays from its seed.

import {
  CAR_LENGTH,
  CAR_WIDTH,
  PLAYER_WIDTH,
  PLAYER_Z,
  CLOCK_MAX,
  CRASH_COOLDOWN,
  UNITS_PER_METRE,
  POINTS_PER_METRE,
  NEAR_MISS_POINTS,
  NEAR_MISS_GAP,
  CHECKPOINT_POINTS,
  CHECKPOINTS_PER_LAP,
  MAX_SPEED,
  RETENTION_DECAY,
  streakMultiplier,
  topUpSeconds,
  trafficCount,
} from "./config.js";
import { buildTrack } from "./track.js";
import { createTraffic, resizeTraffic, updateTraffic, relativeZ } from "./traffic.js";
import { stepPlayer, playerWorldZ, PLAYER_X_LIMIT } from "./player.js";
import { clamp, makeRng, mod, overlap, wrapSigned } from "./util.js";

export const STATUS = { READY: "ready", RACING: "racing", OVER: "over" };

export function createSim({ seed = 1, trackSeed = 1 } = {}) {
  const track = buildTrack(trackSeed);
  return {
    track,
    rng: makeRng(seed),
    seed,
    status: STATUS.READY,

    position: 0,
    playerX: 0,
    speed: 0,
    totalDistance: 0,
    offRoad: false,

    traffic: createTraffic(trafficCount(0)),

    clock: CLOCK_MAX,
    lastTopUp: 0,
    checkpointsPassed: 0,
    laps: 0,
    lapTime: 0,
    lastLap: 0,
    bestLap: Infinity,

    score: 0,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    nearMisses: 0,
    collisions: 0,

    crashCooldown: 0,
    shake: 0,
    elapsed: 0,
    // The retention window is sized from this rather than from the current
    // speed, so a crash does not shrink it instantly and pop the cars just
    // behind the player out of existence. It falls back slowly.
    retentionSpeed: 0,
  };
}

export function startSim(s) {
  s.status = STATUS.RACING;
}

/** Did the interval (prev, prev + delta] cross `target` on a loop of `len`? */
function crossed(prev, delta, target, len) {
  const d = mod(target - prev, len);
  return d > 0 && d <= delta;
}

/**
 * Advance the race by `dt` seconds. Returns the events raised this step so the
 * presentation layer can react without polling for differences.
 */
export function stepSim(s, input, dt) {
  const events = [];
  if (s.status !== STATUS.RACING) return events;

  s.elapsed += dt;
  s.lapTime += dt;
  s.crashCooldown = Math.max(0, s.crashCooldown - dt);
  s.shake = Math.max(0, s.shake - dt * 3);

  const { trackLength } = s.track;
  const prevPosition = s.position;
  const travelled = stepPlayer(s, input, dt);

  s.score += (travelled / UNITS_PER_METRE) * POINTS_PER_METRE;

  // Leaving the road is not a crash, but it does break the streak: the bonus
  // is meant to pay for clean, committed driving and nothing else.
  if (s.offRoad && s.streak > 0) {
    s.streak = 0;
    s.multiplier = 1;
  }

  s.retentionSpeed = Math.max(s.speed, s.retentionSpeed - MAX_SPEED * RETENTION_DECAY * dt);
  updateTraffic(
    s.traffic, playerWorldZ(s), s.speed, s.retentionSpeed, trackLength, dt, s.rng, s.checkpointsPassed,
  );
  resolveTraffic(s, events);

  // Collision resolution moves the car along a contact normal that knows
  // nothing about the verge, so the clamp has to run again after it. It is
  // idempotent, so doing it twice costs nothing.
  s.playerX = clamp(s.playerX, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);

  // Checkpoints and the lap line.
  for (let i = 0; i < s.track.checkpoints.length; i++) {
    if (!crossed(prevPosition, travelled, s.track.checkpoints[i], trackLength)) continue;

    const gained = topUpSeconds(s.checkpointsPassed);
    s.clock = Math.min(CLOCK_MAX, s.clock + gained);
    s.lastTopUp = gained;
    s.checkpointsPassed++;
    s.score += CHECKPOINT_POINTS * s.multiplier;
    resizeTraffic(s.traffic, trafficCount(s.checkpointsPassed));
    events.push({ type: "checkpoint", index: i, gained, clock: s.clock });

    if (i === 0) {
      s.laps++;
      s.lastLap = s.lapTime;
      if (s.lapTime < s.bestLap) s.bestLap = s.lapTime;
      s.lapTime = 0;
      events.push({ type: "lap", lap: s.laps, time: s.lastLap, best: s.bestLap });
    }
  }

  s.clock -= dt;
  if (s.clock <= 0) {
    s.clock = 0;
    s.status = STATUS.OVER;
    events.push({ type: "gameover", score: s.score, distance: s.totalDistance });
  }

  return events;
}

function resolveTraffic(s, events) {
  const { trackLength } = s.track;

  for (const car of s.traffic) {
    if (!car.active) continue;
    // Recomputed per car: a collision below moves the player, and the cars
    // after it in this loop must be measured against where it ended up.
    const pz = playerWorldZ(s);
    const rel = relativeZ(car, pz, trackLength);
    const lateral = Math.abs(s.playerX - car.offset);

    const touching =
      Math.abs(rel) < CAR_LENGTH &&
      overlap(s.playerX, PLAYER_WIDTH, car.offset, CAR_WIDTH, 0.9);

    if (touching && s.crashCooldown <= 0) {
      s.speed = Math.min(car.speed * 0.5, s.speed * 0.2);
      s.position = mod(car.z - PLAYER_Z - CAR_LENGTH, trackLength);
      s.crashCooldown = CRASH_COOLDOWN;
      s.shake = 1;
      s.streak = 0;
      s.multiplier = 1;
      s.collisions++;
      car.counted = true;
      events.push({ type: "collision", speed: s.speed });
      car.lastRel = relativeZ(car, playerWorldZ(s), trackLength);
      continue;
    }

    // A near miss is a car that went from ahead to behind this step, close
    // enough to touch and cleanly threaded.
    if (car.lastRel > 0 && rel <= 0) {
      if (!car.counted && lateral < NEAR_MISS_GAP && !s.offRoad && s.crashCooldown <= 0) {
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        s.multiplier = streakMultiplier(s.streak);
        s.nearMisses++;
        s.score += NEAR_MISS_POINTS * s.multiplier;
        events.push({ type: "nearmiss", streak: s.streak, multiplier: s.multiplier });
      }
      car.counted = true;
    }
    car.lastRel = rel;
  }
}

/** Convenience readouts for the HUD and the tests. */
export const speedKph = (s) => (s.speed / UNITS_PER_METRE) * 3.6;
export const distanceMetres = (s) => s.totalDistance / UNITS_PER_METRE;
export const speedPercent = (s) => s.speed / MAX_SPEED;
export const lapProgress = (s) => s.position / s.track.trackLength;
export const checkpointsPerLap = () => CHECKPOINTS_PER_LAP;
export { wrapSigned };
