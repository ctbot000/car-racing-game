// Traffic: spawning, lane discipline and recycling.
//
// Two rules here are load-bearing and both are easy to get subtly wrong:
//
//  1. A car commits to its final lane before it enters the player's reaction
//     window. A hazard still choosing where to be as it closes is unavoidable
//     rather than difficult, and slowing it down does not help — that halves
//     the warning needed as well.
//
//  2. Retention is a time window, not a distance. Radii picked by eye from a
//     still frame keep cars the player passed seconds ago resident, which both
//     looks impossible and starves the stretch actually on screen.

import {
  LANES,
  SEGMENT_LENGTH,
  CAR_LENGTH,
  TRAFFIC_MIN_SPEED,
  TRAFFIC_MAX_SPEED,
  LANE_CHANGE_SECONDS,
  COMMIT_DISTANCE,
  DECISION_CUTOFF,
  SPAWN_MIN_AHEAD,
  SPAWN_MAX_AHEAD,
  RETENTION_SLACK_SECONDS,
  RETENTION_BEHIND_BASE,
  TRAFFIC_MIN_GAP,
  TRAFFIC_WINDOW,
  trafficWindowBudget,
  MAX_SPEED,
} from "./config.js";
import { clamp, easeInOut, mod, wrapSigned, randRange, randInt } from "./util.js";

export const CAR_SPRITES = 5;

/** Lateral centre of lane `i`, in road half-widths. */
export const laneOffset = (i) => (i - (LANES - 1) / 2) * (2 / LANES);

function makeCar() {
  return {
    active: false,
    z: 0,
    lane: 1,
    offset: 0,
    // Lane changes run as a bounded interpolation so their duration is known,
    // which is what lets the commit distance be computed rather than guessed.
    changeFrom: 0,
    changeTo: 0,
    changeT: 1,
    sprite: 0,
    speed: 0,
    cooldown: 0,
    lastRel: 0,
    counted: false,
    // Bumped on every placement so an observer can tell a recycled car from
    // the one that occupied the same slot before it.
    gen: 0,
  };
}

export function createTraffic(count) {
  return Array.from({ length: count }, makeCar);
}

/** Distance from the player's collision point to a car, signed and wrapped. */
export function relativeZ(car, playerZ, trackLength) {
  return wrapSigned(car.z - playerZ, trackLength);
}

// A car abreast of this one is only a wall if there is no lane left over.
const ABREAST = SEGMENT_LENGTH * 8;

/** Distinct lanes occupied within ABREAST of `car`, including its own. */
function lanesAbreast(cars, car, trackLength) {
  const lanes = new Map([[car.lane, 0]]);
  for (const c of cars) {
    if (c === car || !c.active) continue;
    const d = Math.abs(wrapSigned(c.z - car.z, trackLength));
    if (d >= ABREAST) continue;
    if (!lanes.has(c.lane) || d > lanes.get(c.lane)) lanes.set(c.lane, d);
  }
  return lanes;
}

function spacingOk(cars, z, offset, lane, trackLength, self, budget) {
  let inWindow = 0;
  const abreast = new Set([lane]);
  for (const c of cars) {
    if (c === self || !c.active) continue;
    const d = Math.abs(wrapSigned(c.z - z, trackLength));
    // Pairwise gap: what the player can physically thread between.
    if (d < TRAFFIC_MIN_GAP && Math.abs(c.offset - offset) < 0.55) return false;
    // Rolling budget: what is sustainable over a stretch, kept separate so it
    // does not flatten the track's own rhythm into one constant density.
    if (d < TRAFFIC_WINDOW) inWindow++;
    if (d < ABREAST) abreast.add(c.lane);
  }
  // Never close every lane at once. A hazard with no answer is not difficulty,
  // and at higher densities this is otherwise reachable by chance alone.
  if (abreast.size >= LANES) return false;
  return inWindow < budget;
}

function place(car, cars, playerZ, trackLength, rng, budget) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const z = mod(playerZ + randRange(rng, SPAWN_MIN_AHEAD, SPAWN_MAX_AHEAD), trackLength);
    const lane = randInt(rng, 0, LANES - 1);
    const offset = laneOffset(lane);
    if (!spacingOk(cars, z, offset, lane, trackLength, car, budget)) continue;

    car.active = true;
    car.z = z;
    car.lane = lane;
    car.offset = offset;
    car.changeFrom = offset;
    car.changeTo = offset;
    car.changeT = 1;
    car.speed = randRange(rng, TRAFFIC_MIN_SPEED, TRAFFIC_MAX_SPEED);
    car.sprite = randInt(rng, 0, CAR_SPRITES - 1);
    car.cooldown = randRange(rng, 0.5, 3.5);
    car.lastRel = wrapSigned(z - playerZ, trackLength);
    car.counted = false;
    car.gen++;
    return true;
  }
  return false; // too crowded right now; retried next step
}

/**
 * Advance every car, recycle the ones outside the retention window, and run the
 * lane-change AI. Returns nothing; `cars` is mutated in place.
 */
export function updateTraffic(cars, playerZ, playerSpeed, retentionSpeed, trackLength, dt, rng, checkpointsPassed = 0) {
  const budget = trafficWindowBudget(checkpointsPassed);
  // Sized in time: how far the player travels while a car is worth keeping.
  const behindWindow = RETENTION_BEHIND_BASE + retentionSpeed * RETENTION_SLACK_SECONDS;
  const aheadWindow = SPAWN_MAX_AHEAD + retentionSpeed * RETENTION_SLACK_SECONDS;

  for (const car of cars) {
    if (!car.active) {
      // A failed placement means the road is momentarily full; back off rather
      // than re-rolling twelve candidates every frame for every spare car.
      car.cooldown -= dt;
      if (car.cooldown <= 0) {
        if (!place(car, cars, playerZ, trackLength, rng, budget)) car.cooldown = 0.25;
      }
      continue;
    }

    car.z = mod(car.z + car.speed * dt, trackLength);
    const rel = wrapSigned(car.z - playerZ, trackLength);

    if (rel < -behindWindow || rel > aheadWindow) {
      car.active = false;
      car.cooldown = 0;
      if (!place(car, cars, playerZ, trackLength, rng, budget)) car.cooldown = 0.25;
      continue;
    }

    // Finish any lane change already in flight. By construction this always
    // completes outside COMMIT_DISTANCE.
    if (car.changeT < 1) {
      car.changeT = Math.min(1, car.changeT + dt / LANE_CHANGE_SECONDS);
      car.offset = easeInOut(car.changeFrom, car.changeTo, car.changeT);
      continue;
    }

    // New decisions only well outside the window, so the move has time to land.
    car.cooldown -= dt;
    if (Math.abs(rel) <= DECISION_CUTOFF) continue;

    // Spacing is checked when a car is placed, but cars change lanes and drift
    // together afterwards, so a full-width block can still assemble in transit.
    // Break it here, at the last point a lateral move is still allowed: pulling
    // one car into a lane another already occupies frees a whole lane, and two
    // cars nose-to-tail is a gap where three abreast is a wall.
    const lanes = lanesAbreast(cars, car, trackLength);
    if (lanes.size >= LANES) {
      let target = car.lane;
      let furthest = -1;
      for (const [lane, d] of lanes) {
        if (lane !== car.lane && d > furthest) {
          furthest = d;
          target = lane;
        }
      }
      if (target !== car.lane) {
        car.lane = target;
        car.changeFrom = car.offset;
        car.changeTo = laneOffset(target);
        car.changeT = 0;
        car.cooldown = randRange(rng, 2.5, 7);
        continue;
      }
    }

    if (car.cooldown > 0) continue;
    car.cooldown = randRange(rng, 2.5, 7);
    if (rng() < 0.45) {
      const dir = rng() < 0.5 ? -1 : 1;
      const lane = clamp(car.lane + dir, 0, LANES - 1);
      if (lane !== car.lane) {
        car.lane = lane;
        car.changeFrom = car.offset;
        car.changeTo = laneOffset(lane);
        car.changeT = 0;
      }
    }
  }
}

/** True while a car's lateral position must be held still for the player. */
export function isCommitted(car, playerZ, trackLength) {
  return Math.abs(relativeZ(car, playerZ, trackLength)) <= COMMIT_DISTANCE;
}

/** Resize the pool without disturbing the cars already on the road. */
export function resizeTraffic(cars, count) {
  while (cars.length < count) cars.push(makeCar());
  while (cars.length > count) cars.pop();
  return cars;
}

export const maxClosingSpeed = () => MAX_SPEED - TRAFFIC_MIN_SPEED;
export const carLength = () => CAR_LENGTH;
