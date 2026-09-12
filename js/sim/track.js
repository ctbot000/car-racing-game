// Circuit generation. The track is a closed loop of fixed-length segments, each
// carrying a curve amount and a world-space elevation; everything else (camera,
// projection, colours) is layered on by the renderer.

import {
  SEGMENT_LENGTH,
  RUMBLE_LENGTH,
  CHECKPOINTS_PER_LAP,
} from "./config.js";
import { easeIn, easeInOut, makeRng, randRange, pick, mod } from "./util.js";

export const LENGTH = { NONE: 0, SHORT: 15, MEDIUM: 30, LONG: 60 };
export const CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 };
export const HILL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 };

const SCENERY = ["palm", "palmTall", "bush", "boulder", "billboard"];

function makeSegment(index, curve, y1, y2) {
  return {
    index,
    p1: { world: { x: 0, y: y1, z: index * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { x: 0, y: y2, z: (index + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
    curve,
    sprites: [],
    // Filled in per frame by the renderer.
    looped: false,
    fog: 0,
    clip: 0,
    // Alternating stripe index, so rumble strips and tarmac shades line up.
    dark: Math.floor(index / RUMBLE_LENGTH) % 2 === 0,
    checkpoint: -1,
    startLine: false,
  };
}

class TrackBuilder {
  constructor() {
    this.segments = [];
  }

  lastY() {
    const n = this.segments.length;
    return n === 0 ? 0 : this.segments[n - 1].p2.world.y;
  }

  addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push(makeSegment(n, curve, this.lastY(), y));
  }

  addRoad(enter, hold, leave, curve, height) {
    const startY = this.lastY();
    const endY = startY + height * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    }
    for (let n = 0; n < hold; n++) {
      this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    }
    for (let n = 0; n < leave; n++) {
      this.addSegment(
        easeInOut(curve, 0, n / leave),
        easeInOut(startY, endY, (enter + hold + n) / total),
      );
    }
  }

  addStraight(num = LENGTH.MEDIUM) {
    this.addRoad(num, num, num, 0, 0);
  }

  addCurve(num = LENGTH.MEDIUM, curve = CURVE.MEDIUM, height = HILL.NONE) {
    this.addRoad(num, num, num, curve, height);
  }

  addHill(num = LENGTH.MEDIUM, height = HILL.MEDIUM) {
    this.addRoad(num, num, num, 0, height);
  }

  addSCurves() {
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, -CURVE.EASY, HILL.NONE);
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, CURVE.MEDIUM, HILL.MEDIUM);
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, CURVE.EASY, -HILL.LOW);
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, -CURVE.EASY, HILL.MEDIUM);
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, -CURVE.MEDIUM, -HILL.MEDIUM);
  }

  addLowRollingHills(num = LENGTH.SHORT, height = HILL.LOW) {
    this.addRoad(num, num, num, 0, height / 2);
    this.addRoad(num, num, num, 0, -height);
    this.addRoad(num, num, num, CURVE.EASY, height);
    this.addRoad(num, num, num, 0, 0);
    this.addRoad(num, num, num, -CURVE.EASY, height / 2);
    this.addRoad(num, num, num, 0, 0);
  }

  /**
   * Bring elevation back to where the loop started. The seam is invisible for
   * curve (it eases to zero at the end of every piece) but a leftover height
   * difference would be a cliff across the start/finish line.
   */
  closeLoop() {
    const drop = -this.lastY() / SEGMENT_LENGTH;
    this.addRoad(LENGTH.MEDIUM, LENGTH.MEDIUM, LENGTH.MEDIUM, 0, drop);
    // Nudge out any rounding residue so p2 of the last segment is exactly 0.
    const last = this.segments[this.segments.length - 1];
    last.p2.world.y = 0;
    // Keep the stripe pattern continuous across the seam.
    while (this.segments.length % (RUMBLE_LENGTH * 2) !== 0) {
      this.addSegment(0, 0);
    }
  }
}

/** Scatter roadside scenery. Density varies along the track so the sparse
 *  stretches stay sparse instead of being levelled out to a constant. */
function addScenery(segments, rng) {
  for (let n = 10; n < segments.length; n++) {
    const seg = segments[n];
    // A slow wave over the whole lap gives alternating dense and open country.
    const wave = 0.5 + 0.5 * Math.sin((n / segments.length) * Math.PI * 6);
    const density = 0.04 + wave * 0.16;

    if (rng() < density) {
      const side = rng() < 0.5 ? -1 : 1;
      const source = pick(rng, SCENERY);
      const offset = side * randRange(rng, 1.35, source === "billboard" ? 2.1 : 4.5);
      seg.sprites.push({ source, offset });
    }
    // Lamp posts march down the left-hand verge at a fixed interval.
    if (n % 24 === 0) {
      seg.sprites.push({ source: "lamp", offset: -1.24 });
    }
    // A marker post every stripe on the outside of the road reads as speed.
    if (n % 6 === 0) {
      seg.sprites.push({ source: "post", offset: 1.2 });
    }
  }
}

/**
 * Build the circuit. Seeded, so a balance run that fails can be replayed.
 */
export function buildTrack(seed = 1) {
  const rng = makeRng(seed);
  const b = new TrackBuilder();

  // Start/finish straight, deliberately flat and open so the lights, the grid
  // and the first braking point are all readable.
  b.addStraight(LENGTH.SHORT);
  b.addLowRollingHills(LENGTH.SHORT, HILL.LOW);
  b.addSCurves();
  b.addCurve(LENGTH.MEDIUM, CURVE.MEDIUM, -HILL.LOW);
  b.addCurve(LENGTH.LONG, -CURVE.MEDIUM, HILL.MEDIUM);
  b.addStraight(LENGTH.MEDIUM);
  b.addHill(LENGTH.MEDIUM, -HILL.HIGH);
  b.addCurve(LENGTH.LONG, CURVE.HARD, HILL.LOW);
  b.addCurve(LENGTH.MEDIUM, -CURVE.MEDIUM, -HILL.MEDIUM);
  b.addCurve(LENGTH.LONG, -CURVE.EASY, -HILL.LOW);
  b.addStraight(LENGTH.SHORT);
  b.closeLoop();

  const segments = b.segments;
  addScenery(segments, rng);

  const trackLength = segments.length * SEGMENT_LENGTH;

  // A band, not a stripe: one segment is 1.4 m of road and flashes past
  // unseen at racing speed.
  const BAND = RUMBLE_LENGTH * 4;
  for (let i = 0; i < BAND; i++) segments[i].startLine = true;

  const checkpoints = [];
  for (let i = 0; i < CHECKPOINTS_PER_LAP; i++) {
    const z = (trackLength / CHECKPOINTS_PER_LAP) * i;
    const index = Math.floor(z / SEGMENT_LENGTH);
    checkpoints.push(z);
    if (i === 0) continue; // checkpoint zero is the start line itself
    for (let k = 0; k < BAND; k++) segments[(index + k) % segments.length].checkpoint = i;
  }

  return { segments, trackLength, checkpoints, seed };
}

export function findSegment(track, z) {
  const i = Math.floor(mod(z, track.trackLength) / SEGMENT_LENGTH);
  return track.segments[i];
}
