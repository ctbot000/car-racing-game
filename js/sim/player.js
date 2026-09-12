// Player physics. Pure: given state, input and dt it mutates the numbers and
// nothing else, which is what lets the balance tests drive it headlessly.

import {
  ACCEL,
  BRAKING,
  DECEL,
  OFF_ROAD_DECEL,
  OFF_ROAD_LIMIT,
  MAX_SPEED,
  STEER_RATE,
  CENTRIFUGAL,
  PLAYER_Z,
} from "./config.js";
import { accelerate, clamp, mod } from "./util.js";
import { findSegment } from "./track.js";

export const PLAYER_X_LIMIT = 2.4;

export function stepPlayer(s, input, dt) {
  const { track } = s;
  const segment = findSegment(track, s.position + PLAYER_Z);
  const speedPercent = s.speed / MAX_SPEED;
  const dx = dt * STEER_RATE * speedPercent;

  if (input.left) s.playerX -= dx;
  else if (input.right) s.playerX += dx;

  // Curves push the car to the outside, harder the faster it is going. This is
  // the whole reason to lift for a corner rather than hold the throttle flat.
  s.playerX -= dx * speedPercent * segment.curve * CENTRIFUGAL;

  if (input.accel) s.speed = accelerate(s.speed, ACCEL, dt);
  else if (input.brake) s.speed = accelerate(s.speed, BRAKING, dt);
  else s.speed = accelerate(s.speed, DECEL, dt);

  s.offRoad = s.playerX < -1 || s.playerX > 1;
  if (s.offRoad && s.speed > OFF_ROAD_LIMIT) {
    s.speed = accelerate(s.speed, OFF_ROAD_DECEL, dt);
  }

  s.speed = clamp(s.speed, 0, MAX_SPEED);
  s.playerX = clamp(s.playerX, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);

  const travelled = s.speed * dt;
  s.position = mod(s.position + travelled, track.trackLength);
  s.totalDistance += travelled;
  return travelled;
}

export const playerWorldZ = (s) => mod(s.position + PLAYER_Z, s.track.trackLength);
