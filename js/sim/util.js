// Pure math helpers. No DOM and no module-level state: everything here is
// imported by the headless balance tests as well as by the browser build.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const easeIn = (a, b, t) => a + (b - a) * t * t;
export const easeOut = (a, b, t) => a + (b - a) * (1 - (1 - t) * (1 - t));
export const easeInOut = (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);

// Integrate a rate over dt. `rate` is in units per second.
export const accelerate = (v, rate, dt) => v + rate * dt;

export const exponentialFog = (distance, density) =>
  1 / Math.pow(Math.E, distance * distance * density);

// Always-positive modulo. `%` keeps the sign of the dividend in JS, which is
// the wrong answer for a looping track coordinate.
export const mod = (n, m) => ((n % m) + m) % m;

// Shortest signed distance from `a` to `b` on a loop of length `len`.
// Positive means `b` is ahead of `a`.
export const wrapSigned = (delta, len) => mod(delta + len / 2, len) - len / 2;

// A value is only usable if it is finite. Math.max(1, NaN) is NaN, so clamping
// a loop bound or a step count through Math.max silently turns the step into a
// no-op; every derived count goes through here instead.
export const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// Two axis-aligned spans overlap, with `percent` shrinking both halves so a
// graze can be tuned independently of the drawn sprite width.
export function overlap(x1, w1, x2, w2, percent = 1) {
  const half = percent / 2;
  const min1 = x1 - w1 * half;
  const max1 = x1 + w1 * half;
  const min2 = x2 - w2 * half;
  const max2 = x2 + w2 * half;
  return !(max1 < min2 || min1 > max2);
}

// mulberry32: small, fast, and seeded, so a failing balance run replays exactly.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, lo, hi) => lo + rng() * (hi - lo);
export const randInt = (rng, lo, hi) => Math.floor(randRange(rng, lo, hi + 1));
export const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

// Gaussian via Box-Muller, for timing error in the simulated players.
export function randNormal(rng, mean = 0, sd = 1) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--.--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
