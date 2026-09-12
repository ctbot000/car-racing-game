// Simulated drivers for the balance tests.
//
// Three rules govern this controller and all three are easy to get wrong:
//
//  * Error is sampled once per DECISION - per car encountered, per corner
//    approached - and held for the whole of it. A per-tick miss chance is an
//    8ms delay, not a handicap, and leaves the survival curve flat however high
//    it is turned up.
//
//  * Perception must include what currently overlaps the car, not only what
//    lies ahead. A filter written as `rel > 0` drops the car the driver is
//    alongside and steers into it, which makes every skill profile fail the
//    same way and reads as a balance problem rather than a blind controller.
//
//  * Steering is rate limited, so a gap is only worth aiming at if it can be
//    reached before the obstacle arrives. Planning in distance instead of time
//    to contact picks gaps the car cannot physically get to.

import { SEGMENT_LENGTH, CAR_LENGTH, CENTRIFUGAL, MAX_SPEED, BRAKING, STEER_RATE }
  from "../js/sim/config.js";
import { findSegment } from "../js/sim/track.js";
import { relativeZ } from "../js/sim/traffic.js";
import { playerWorldZ } from "../js/sim/player.js";
import { clamp, makeRng, randNormal } from "../js/sim/util.js";

export const PROFILES = {
  flawless: { jitter: 0, whiff: 0, label: "flawless" },
  expert: { jitter: 0.08, whiff: 0.015, label: "expert" },
  average: { jitter: 0.2, whiff: 0.06, label: "average" },
  beginner: { jitter: 0.4, whiff: 0.16, label: "beginner" },
};

const PLAN_HORIZON = 3.0; // seconds of traffic the driver plans against
const AVOID_HALF_WIDTH = 0.36; // comfortably outside the 0.27 collision threshold
const FOLLOW_HORIZON = 1.8; // seconds; below this, fall in behind rather than hope
const SAFE_CLEARANCE = 0.55; // below this, prefer a clear lane over threading a gap
const DEADBAND = 0.035; // bang-bang with no deadband drifts to one extreme

export function makeBot(profileName = "flawless", seed = 7) {
  const profile = PROFILES[profileName] ?? PROFILES.flawless;
  const rng = makeRng(seed);
  const decisions = new Map();
  let corner = null;

  const jittered = (base) =>
    profile.jitter === 0 ? base : base * (1 + randNormal(rng, 0, profile.jitter));

  function decisionFor(key, car) {
    let d = decisions.get(key);
    if (!d || d.gen !== car.gen) {
      d = {
        gen: car.gen,
        // The reaction offset moves WHEN the driver starts working the gap.
        // Early-or-late, not absent; absence is the separate whiff roll.
        trigger: Math.max(0.5, jittered(PLAN_HORIZON)),
        whiff: rng() < profile.whiff,
      };
      decisions.set(key, d);
    }
    return d;
  }

  return function input(s) {
    const track = s.track;
    const pz = playerWorldZ(s);
    const speedPct = s.speed / MAX_SPEED;

    // --- the racing line --------------------------------------------------
    const look = Math.round(18 + 42 * speedPct);
    let curveSum = 0;
    for (let i = 1; i <= look; i++) {
      curveSum += findSegment(track, pz + i * SEGMENT_LENGTH).curve;
    }
    const curve = curveSum / look;
    const line = clamp(-curve * 0.11, -0.6, 0.6);

    // --- threats, ranked by time to contact -------------------------------
    const threats = [];
    for (let i = 0; i < s.traffic.length; i++) {
      const car = s.traffic[i];
      if (!car.active) continue;
      const rel = relativeZ(car, pz, track.trackLength);
      if (rel < -CAR_LENGTH * 1.6) continue; // behind and clear
      const closing = Math.max(200, s.speed - car.speed);
      const ttc = rel / closing;
      if (ttc > PLAN_HORIZON * 2) {
        decisions.delete(i);
        continue;
      }
      const d = decisionFor(i, car);
      if (d.whiff || ttc > d.trigger) continue;
      threats.push({ centre: car.offset, ttc: Math.max(0, ttc), speed: car.speed });
    }

    const steerRate = Math.max(0.3, STEER_RATE * speedPct);

    let bestOffset = line;
    let bestCost = Infinity;
    for (let x = -0.9; x <= 0.901; x += 0.02) {
      const reachIn = Math.abs(x - s.playerX) / steerRate;
      let cost = Math.abs(x - line) * 0.8 + reachIn * 0.4;
      if (Math.abs(x) > 0.82) cost += 1.5; // hugging the verge invites a trip off it
      for (const t of threats) {
        // Score where the car will actually BE when this threat arrives, not
        // where the slot is. Steering is rate limited, so a gap on the far side
        // of the road is worth nothing against a car half a second away - and
        // scoring the destination instead makes the controller pick gaps it
        // cannot reach.
        const tEval = clamp(t.ttc, 0.15, 2.5);
        const travel = Math.min(Math.abs(x - s.playerX), steerRate * tEval);
        const xAt = s.playerX + Math.sign(x - s.playerX) * travel;
        const clearance = Math.abs(xAt - t.centre);
        const urgency = 1 / Math.max(0.3, t.ttc);
        if (clearance < AVOID_HALF_WIDTH) {
          cost += (60 + 60 * (1 - clearance / AVOID_HALF_WIDTH)) * urgency;
        } else if (clearance < SAFE_CLEARANCE) {
          // Aim for the middle of a gap, not its edge. Without this the car
          // threads at the collision threshold and one step of centrifugal
          // drift is a sideswipe.
          cost += 9 * urgency * (1 - clearance / SAFE_CLEARANCE);
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestOffset = x;
      }
    }

    // --- speed ------------------------------------------------------------
    const stopping = (s.speed * s.speed) / (2 * Math.abs(BRAKING));
    const brakeLook = clamp(Math.ceil(stopping / SEGMENT_LENGTH) + 14, 14, 140);
    if (!corner || corner.expires < s.elapsed) {
      corner = {
        expires: s.elapsed + 0.4,
        margin: jittered(1),
        lift: !(rng() < profile.whiff),
      };
    }
    let worst = 0;
    for (let i = 1; i <= brakeLook; i++) {
      const c = Math.abs(findSegment(track, pz + i * SEGMENT_LENGTH).curve);
      if (c > worst) worst = c;
    }
    // Steering authority cancels centrifugal drift at speedPct = 1/(curve*k);
    // stay under that so there is something left to correct with.
    const hold = worst > 0.05 ? 1 / (worst * CENTRIFUGAL) : 1;
    let targetPct = clamp(hold * 0.9 * (corner.lift ? corner.margin : 1.4), 0.3, 1);

    // Cannot get out of the way in time: match the blocker's pace instead.
    // The horizon is fixed rather than derived from the steering time, because
    // shedding speed takes far longer than changing lane does - deciding to
    // slow only once the gap has closed is deciding too late.
    const trapped = threats.filter(
      (t) =>
        t.ttc < FOLLOW_HORIZON &&
        (Math.abs(bestOffset - t.centre) < AVOID_HALF_WIDTH ||
          Math.abs(s.playerX - t.centre) < AVOID_HALF_WIDTH),
    );
    if (trapped.length) {
      const slowest = Math.min(...trapped.map((t) => t.speed));
      targetPct = Math.min(targetPct, (slowest / MAX_SPEED) * 0.92);
    }
    if (Math.abs(s.playerX) > 0.95) targetPct = Math.min(targetPct, 0.55);

    const delta = bestOffset - s.playerX;
    return {
      left: delta < -DEADBAND,
      right: delta > DEADBAND,
      accel: speedPct < targetPct,
      brake: speedPct > targetPct + 0.015,
    };
  };
}
