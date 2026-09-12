// Persistence for the best run.
//
// localStorage throws on every access in some privacy modes, so a helper that
// catches and returns turns a failed write into a silent one - and then the
// next read hands back the pre-write value and contradicts it inside the same
// session. The values live in memory; storage is write-through, and losing it
// costs persistence across reloads and nothing else.

const KEY = "sunset-circuit.best.v1";

const EMPTY = { score: 0, distance: 0, laps: 0, bestLap: null, streak: 0 };

let cache = null;
let writable = true;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    // `stored || DEFAULT` would quietly reset a legitimate zero, so each field
    // is tested for absence rather than for falsiness.
    const out = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) {
      if (parsed[k] !== undefined && parsed[k] !== null) out[k] = parsed[k];
    }
    return out;
  } catch {
    writable = false;
    return { ...EMPTY };
  }
}

export function best() {
  if (cache === null) cache = read();
  return cache;
}

export function isPersistent() {
  best();
  return writable;
}

/** Merge a finished run in, keeping the better of each field. Returns what improved. */
export function recordRun({ score, distance, laps, bestLap, streak }) {
  const current = best();
  const improved = {};
  if (score > current.score) {
    current.score = score;
    improved.score = true;
  }
  if (distance > current.distance) current.distance = distance;
  if (laps > current.laps) current.laps = laps;
  if (streak > current.streak) current.streak = streak;
  if (Number.isFinite(bestLap) && (current.bestLap === null || bestLap < current.bestLap)) {
    current.bestLap = bestLap;
    improved.bestLap = true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    writable = false;
  }
  return improved;
}

export function clearBest() {
  cache = { ...EMPTY };
  try {
    localStorage.removeItem(KEY);
  } catch {
    writable = false;
  }
}
