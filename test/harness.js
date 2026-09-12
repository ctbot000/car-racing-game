// Drives a sim with a bot at a fixed timestep and reports what happened.
import { createSim, startSim, stepSim, STATUS } from "../js/sim/sim.js";
import { FIXED_STEP, CHECKPOINTS_PER_LAP } from "../js/sim/config.js";
import { makeBot } from "./bot.js";

export function race({
  profile = "flawless",
  seed = 1,
  trackSeed = 1,
  botSeed = 7,
  maxSeconds = 600,
  traffic = true,
} = {}) {
  const s = createSim({ seed, trackSeed });
  if (!traffic) s.traffic.length = 0;
  startSim(s);
  const bot = makeBot(profile, botSeed);

  const checkpointTimes = [];
  let last = 0;
  let collisions = 0;
  let minClock = Infinity;

  while (s.status === STATUS.RACING && s.elapsed < maxSeconds) {
    const events = stepSim(s, bot(s), FIXED_STEP);
    for (const e of events) {
      if (e.type === "checkpoint") {
        checkpointTimes.push(s.elapsed - last);
        last = s.elapsed;
      }
      if (e.type === "collision") collisions++;
    }
    if (s.clock < minClock) minClock = s.clock;
  }

  const laps = s.laps + s.checkpointsPassed / CHECKPOINTS_PER_LAP - s.laps;
  return {
    sim: s,
    survived: s.elapsed,
    timedOut: s.status === STATUS.RACING,
    checkpoints: s.checkpointsPassed,
    checkpointTimes,
    collisions,
    nearMisses: s.nearMisses,
    score: s.score,
    laps: s.laps,
    bestLap: s.bestLap,
    minClock,
    _laps: laps,
  };
}

export const median = (xs) => {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
