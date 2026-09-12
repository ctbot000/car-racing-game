// Every tuning number lives here, in one unit system.
//
// World units are chosen so that one metre is UNITS_PER_METRE units; the HUD
// then reads out in km/h and metres without a second, disagreeing scale
// hiding somewhere in the render code.

export const UNITS_PER_METRE = 144;

export const SEGMENT_LENGTH = 200; // world units of road per segment
export const RUMBLE_LENGTH = 3; // segments per rumble-strip stripe
export const ROAD_WIDTH = 800; // half-width, so the road spans -1..1 in offsets
export const LANES = 3;

// 12000 u/s === 83.3 m/s === 300 km/h
export const MAX_SPEED = SEGMENT_LENGTH * 60;
export const ACCEL = MAX_SPEED / 6.0;
export const BRAKING = -MAX_SPEED / 2.0;
export const DECEL = -MAX_SPEED / 9.0;
export const OFF_ROAD_DECEL = -MAX_SPEED / 1.4;
export const OFF_ROAD_LIMIT = MAX_SPEED / 3.6;

export const STEER_RATE = 2.4; // road half-widths per second at full speed
export const CENTRIFUGAL = 0.28; // how hard curves push the car outward
// Car width as a fraction of the road half-width. A lane is 2/LANES wide, so
// 0.30 puts a car at about 45% of its lane - roughly a real car in a real lane,
// and the proportion the sprites are drawn to.
export const PLAYER_WIDTH = 0.30;
export const CAR_WIDTH = 0.30;
export const CAR_LENGTH = SEGMENT_LENGTH * 1.6;

// Camera. PLAYER_Z is how far in front of the camera the car sits, which is
// also the point collisions are measured from.
export const CAMERA_HEIGHT = 520;
export const FIELD_OF_VIEW = 100;
export const CAMERA_DEPTH = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;
export const DRAW_DISTANCE = 300; // segments
export const FOG_DENSITY = 5;

// --- Traffic ------------------------------------------------------------
//
// A hazard that is still choosing where to be while it closes on the player is
// unavoidable rather than hard, so a traffic car commits to a final lane before
// it enters the player's reaction window and holds it from there in.

export const TRAFFIC_MIN_SPEED = MAX_SPEED * 0.30;
export const TRAFFIC_MAX_SPEED = MAX_SPEED * 0.62;
export const REACTION_BUDGET = 0.8; // seconds of warning the player is owed
export const LANE_CHANGE_SECONDS = 1.2;

// Worst-case closing speed: player flat out, traffic at its slowest.
export const MAX_CLOSING_SPEED = MAX_SPEED - TRAFFIC_MIN_SPEED;

// Inside this distance a car's lateral offset is frozen.
export const COMMIT_DISTANCE = MAX_CLOSING_SPEED * REACTION_BUDGET;
// Beyond this one it may start a lane change; the gap between the two is sized
// so any change begun at the cutoff has finished before the commit distance.
export const DECISION_CUTOFF =
  COMMIT_DISTANCE + MAX_CLOSING_SPEED * LANE_CHANGE_SECONDS + SEGMENT_LENGTH * 10;

export const SPAWN_MIN_AHEAD = DECISION_CUTOFF + SEGMENT_LENGTH * 20;
export const SPAWN_MAX_AHEAD = SPAWN_MIN_AHEAD + SEGMENT_LENGTH * 340;

// Retention is sized in time, not distance: a window picked from a still frame
// keeps cars the player left behind long ago resident once the speeds are real.
export const RETENTION_SLACK_SECONDS = 2.0;
export const RETENTION_DECAY = 0.15; // fraction of top speed the window sheds per second
export const RETENTION_BEHIND_BASE = SEGMENT_LENGTH * 30;

// Spacing has two separate jobs. The pairwise gap is what the player can
// physically thread; the rolling window is what is sustainable. One rule doing
// both would replace the track's own rhythm with a constant worst case.
export const TRAFFIC_MIN_GAP = CAR_LENGTH * 3.2;
export const TRAFFIC_WINDOW = SEGMENT_LENGTH * 90;

// The budget is what actually sets local density, so it is the knob that has to
// move with difficulty; the pool size only decides how many cars can be
// resident at once and is derived from it.
export const WINDOW_BUDGET_MIN = 2;
export const WINDOW_BUDGET_MAX = 5;

export const trafficWindowBudget = (checkpointsPassed) =>
  Math.min(WINDOW_BUDGET_MAX, WINDOW_BUDGET_MIN + Math.floor(checkpointsPassed / 5));

// --- Scoring ------------------------------------------------------------
//
// Base pay is flat per metre so a struggling player is not further punished.
// The streak multiplier rides only on the discretionary part — near misses and
// checkpoints — where only sustained clean driving can reach the cap.

export const POINTS_PER_METRE = 0.45;
export const NEAR_MISS_POINTS = 120;
export const CHECKPOINT_POINTS = 400;
// A close pass. Lane centres are 2/LANES apart, so overtaking in the
// neighbouring lane clears by about one car width - close enough at 300 km/h to
// be worth points, and the streak it feeds is what separates a clean run from a
// merely long one.
export const NEAR_MISS_GAP = 0.75;
export const STREAK_STEP = 0.1;
export const STREAK_CAP = 20; // multiplier tops out at 3.0x

export const streakMultiplier = (streak) =>
  1 + Math.min(streak, STREAK_CAP) * STREAK_STEP;

// --- The clock ----------------------------------------------------------
//
// The run ends when the clock does. It drains continuously and is topped up a
// fixed amount per checkpoint, which collapses the whole difficulty curve into
// one number: with a buffer of M units' worth of time and a top-up worth k of a
// unit's cost, play is sustainable exactly while
//
//     actual seconds per checkpoint / optimal seconds per checkpoint  <  k
//
// k falls monotonically with progress, so early checkpoints bank time and late
// ones net-drain however well they are driven. No plateau to camp on, and the
// threshold is a closed form the tests assert is monotone.

export const CHECKPOINTS_PER_LAP = 3;

// Measured, not guessed: a flawless simulated driver averages this per
// checkpoint through traffic, and it is flat across the whole run (see
// test/balance.test.js, which fails if the constant drifts away from it).
export const UNIT_COST_SECONDS = 12.3;

export const CLOCK_BUFFER_UNITS = 2.2; // M
export const CLOCK_MAX = UNIT_COST_SECONDS * CLOCK_BUFFER_UNITS;

export const K_START = 1.12;
export const K_STEP = 0.01;
// Deliberately below 1: this is an endless run, so it has to end for everybody
// and the score is how far you got. (In a level-based game a threshold under
// 1.0 would mean an impossible level; here it is the design.)
export const K_FLOOR = 0.3;

export const topUpFactor = (checkpointsPassed) =>
  Math.max(K_FLOOR, K_START - K_STEP * checkpointsPassed);

export const topUpSeconds = (checkpointsPassed) =>
  UNIT_COST_SECONDS * topUpFactor(checkpointsPassed);

/** How much slower than optimal a player may be and still survive here. */
export const survivalThreshold = (checkpointsPassed) => topUpFactor(checkpointsPassed);

// Traffic density rises with progress too, but gently: the clock is meant to
// be what escalates, and two curves climbing at once is a curve nobody can
// reason about. The pool is sized so placement usually succeeds first try -
// roughly (retained span / window) cars per unit of budget.
export const trafficCount = (checkpointsPassed) =>
  Math.round(3.4 * trafficWindowBudget(checkpointsPassed)) + 2;

export const CRASH_COOLDOWN = 0.7; // seconds of immunity after a hit
export const FIXED_STEP = 1 / 60;
