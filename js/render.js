// The pseudo-3D road renderer.
//
// Each segment of the circuit is projected from the camera and drawn as a
// trapezoid, near to far, with a running clip line so a crest hides the road
// behind it. Sprites are then drawn far to near, clipped to the same line.

import {
  ROAD_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_DEPTH,
  DRAW_DISTANCE,
  FOG_DENSITY,
  SEGMENT_LENGTH,
  RUMBLE_LENGTH,
  LANES,
  PLAYER_Z,
  MAX_SPEED,
} from "./sim/config.js";
import { findSegment } from "./sim/track.js";
import { exponentialFog, makeRng, mod } from "./sim/util.js";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const PALETTE = {
  light: { road: "#4b4759", grass: "#1d5b52", rumble: "#fdf6ff", lane: "#eef1fb" },
  dark: { road: "#433f50", grass: "#1a5449", rumble: "#ff4d6d", lane: null },
  start: { road: "#e9edf8", grass: "#1d5b52", rumble: "#14102a", lane: null },
  startAlt: { road: "#14102a", grass: "#1d5b52", rumble: "#e9edf8", lane: null },
  checkpoint: { road: "#5c4a7d", grass: "#23606f", rumble: "#6ff0ff", lane: "#eef1fb" },
  fog: "#3a2360",
  horizon: "#ff8a5b",
};

// The stage is not a fixed shape - it fills a desktop window and a phone held
// either way - so the projection has to be aspect-correct. Scaling y by
// height/2, as the classic form does, stretches the world vertically the moment
// the stage stops being the shape it was tuned at. Both axes are therefore
// scaled from the width, against a reference aspect, so the horizontal field of
// view is fixed and a taller stage simply shows more road.
export const REF_ASPECT = 16 / 10;
export const MIN_ASPECT = 0.62;
export const MAX_ASPECT = 1.9;

/** Camera transform for one point of a segment. */
function project(p, cameraX, cameraY, cameraZ, width, roadWidth, vScale, vAnchor) {
  p.camera.x = (p.world.x || 0) - cameraX;
  p.camera.y = (p.world.y || 0) - cameraY;
  p.camera.z = (p.world.z || 0) - cameraZ;
  p.screen.scale = CAMERA_DEPTH / p.camera.z;
  p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(vAnchor - p.screen.scale * p.camera.y * vScale);
  p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
}

function polygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

const rumbleWidth = (projectedWidth) => projectedWidth / Math.max(6, 2 * LANES);
const laneMarkerWidth = (projectedWidth) => projectedWidth / Math.max(32, 8 * LANES);

function renderSegment(ctx, width, x1, y1, w1, x2, y2, w2, colour) {
  const r1 = rumbleWidth(w1);
  const r2 = rumbleWidth(w2);

  ctx.fillStyle = colour.grass;
  ctx.fillRect(0, y2, width, y1 - y2);

  polygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, colour.rumble);
  polygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, colour.rumble);
  polygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, colour.road);

  if (!colour.lane) return;
  const l1 = laneMarkerWidth(w1);
  const l2 = laneMarkerWidth(w2);
  let lw1 = (w1 * 2) / LANES;
  let lw2 = (w2 * 2) / LANES;
  let lx1 = x1 - w1 + lw1;
  let lx2 = x2 - w2 + lw2;
  for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
    polygon(ctx, lx1 - l1, y1, lx1 + l1, y1, lx2 + l2, y2, lx2 - l2, y2, colour.lane);
  }
}

function renderSprite(ctx, width, roadWidth, sprite, scale, roadX, roadY, offsetX, offsetY, clipY) {
  const destW = sprite.worldWidth * ((scale * roadWidth * width) / 2);
  const destH = destW * (sprite.height / sprite.width);
  const destX = roadX + destW * (offsetX || 0);
  const destY = roadY + destH * (offsetY || 0);

  const clipH = clipY ? Math.max(0, destY + destH - clipY) : 0;
  if (clipH >= destH) return;
  if (destW < 0.5 || destH < 0.5) return;

  ctx.drawImage(
    sprite.canvas,
    0,
    0,
    sprite.width,
    sprite.height * (1 - clipH / destH),
    destX,
    destY,
    destW,
    destH - clipH,
  );
}

/** Two silhouette ridges, generated once and tiled with parallax. */
function buildHills(width, height, seed, layers) {
  const rng = makeRng(seed);
  const w = Math.max(2, Math.round(width * 2));
  const h = Math.max(2, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  for (const layer of layers) {
    ctx.fillStyle = layer.colour;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const step = w / layer.peaks;
    let y = h * layer.base;
    for (let x = 0; x <= w + step; x += step) {
      y = h * layer.base - rng() * h * layer.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let width = 0;
  let height = 0;
  let vScale = 0;
  let vAnchor = 0;
  let camHeight = CAMERA_HEIGHT;
  let playerScreenY = 0;
  let hillsNear = null;
  let hillsFar = null;
  let sky = null;

  function resize(cssWidth, cssHeight, dpr) {
    width = Math.max(320, Math.round(cssWidth));
    height = Math.max(200, Math.round(cssHeight));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    vScale = width / (2 * REF_ASPECT);
    // On a tall stage the extra room should go to the road, not to more sky, so
    // the horizon rides up as the stage gets narrower. At the reference aspect
    // this is exactly height/2, which is where the look was tuned.
    const aspect = width / height;
    vAnchor = height * Math.min(0.5, Math.max(0.3, (0.5 * aspect) / REF_ASPECT));

    // The camera rises as the stage narrows. Without this the nearest segment
    // the near plane admits lands halfway up a portrait screen, and one 1.4 m
    // strip of tarmac fills a third of the view. Raising the camera in inverse
    // proportion holds the closest visible road at a constant distance, which
    // is what keeps the framing the same on every shape of screen.
    camHeight = Math.min(
      CAMERA_HEIGHT * 2.6,
      Math.max(CAMERA_HEIGHT * 0.85, (CAMERA_HEIGHT * REF_ASPECT) / aspect),
    );
    // Where the road surface is at the car's own depth: with the camera moving,
    // a fixed fraction of the height would float the car above the tarmac.
    playerScreenY = vAnchor + (CAMERA_DEPTH / PLAYER_Z) * camHeight * vScale - height * 0.05;

    const band = Math.round(height * 0.46);
    hillsFar = buildHills(width, band, 11, [
      { colour: "#4a2a63", peaks: 14, base: 1.0, amp: 0.55 },
    ]);
    hillsNear = buildHills(width, band, 29, [
      { colour: "#311c47", peaks: 22, base: 1.0, amp: 0.38 },
    ]);

    sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#140a2e");
    sky.addColorStop(0.32, "#3d1b5c");
    sky.addColorStop(0.58, "#8d2f6b");
    sky.addColorStop(0.78, "#e0555f");
    sky.addColorStop(1, "#ff9a5b");
  }

  function renderBackground(state, horizonY, curveOffset) {
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Sun: a synthwave disc, banded below its midline.
    const sunR = height * 0.22;
    const sunX = width * 0.5 - curveOffset * 0.35;
    const sunY = horizonY - sunR * 0.35;
    const glow = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.6);
    glow.addColorStop(0, "rgba(255,180,110,0.5)");
    glow.addColorStop(1, "rgba(255,120,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, horizonY + sunR);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.clip();
    const disc = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    disc.addColorStop(0, "#fff1b8");
    disc.addColorStop(0.5, "#ffb057");
    disc.addColorStop(1, "#ff3f6e");
    ctx.fillStyle = disc;
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.fillStyle = "rgba(20,10,46,0.85)";
    for (let i = 0; i < 7; i++) {
      const y = sunY + sunR * 0.08 + i * sunR * 0.15;
      ctx.fillRect(sunX - sunR, y, sunR * 2, sunR * 0.035 + i * sunR * 0.012);
    }
    ctx.restore();

    // Ridges. The tiling offset is rounded once, here: a fractional destination
    // coordinate puts every tile on the same wrong phase and seams each edge.
    for (const [layer, speed, drop] of [
      [hillsFar, 0.22, 0.0],
      [hillsNear, 0.42, 0.055],
    ]) {
      if (!layer) continue;
      const band = layer.height;
      const y = Math.round(horizonY - band + height * drop);
      const offset = Math.round(mod(curveOffset * speed, layer.width / 2));
      ctx.drawImage(layer, -offset, y);
      ctx.drawImage(layer, -offset + layer.width / 2, y);
    }
  }

  function render(state, sprites, view) {
    const { track } = state;
    const segments = track.segments;
    const baseSegment = findSegment(track, state.position);
    const basePercent = mod(state.position, SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerSegment = findSegment(track, state.position + PLAYER_Z);
    const playerPercent = mod(state.position + PLAYER_Z, SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerY =
      playerSegment.p1.world.y +
      (playerSegment.p2.world.y - playerSegment.p1.world.y) * playerPercent;

    // Projection runs as its own pass. The road's true horizon is wherever the
    // furthest drawn segment lands, and that moves with the terrain ahead -
    // guessing it from a formula leaves the ridges floating above the grass or
    // buried in it. So: project, find the horizon, paint the sky to meet it,
    // then draw the road.
    let maxy = height;
    let x = 0;
    let dx = -(baseSegment.curve * basePercent);
    const drawable = [];

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = segments[(baseSegment.index + n) % segments.length];
      segment.looped = segment.index < baseSegment.index;
      segment.fog = exponentialFog(n / DRAW_DISTANCE, FOG_DENSITY);
      segment.clip = maxy;

      const camZ = state.position - (segment.looped ? track.trackLength : 0);
      project(segment.p1, state.playerX * ROAD_WIDTH - x, playerY + camHeight, camZ, width, ROAD_WIDTH, vScale, vAnchor);
      project(segment.p2, state.playerX * ROAD_WIDTH - x - dx, playerY + camHeight, camZ, width, ROAD_WIDTH, vScale, vAnchor);

      x += dx;
      dx += segment.curve;

      if (
        segment.p1.camera.z <= CAMERA_DEPTH ||
        segment.p2.screen.y >= segment.p1.screen.y ||
        segment.p2.screen.y >= maxy
      ) {
        continue;
      }

      drawable.push(segment);
      maxy = segment.p1.screen.y;
    }

    const horizonY = drawable.length ? drawable[drawable.length - 1].p2.screen.y : vAnchor;
    renderBackground(state, horizonY, view.curveOffset);

    // The nearest drawable segment is the one just past the near plane, and on
    // a narrow stage it lands well above the bottom of the screen, leaving a
    // band of bare canvas under the car. The road's edges are straight lines on
    // a plane, so their projection is straight too: extend them to the bottom.
    if (drawable.length) {
      const near = drawable[0];
      const dy = near.p1.screen.y - near.p2.screen.y;
      if (near.p1.screen.y < height && dy > 0) {
        const t = (height - near.p1.screen.y) / dy;
        const l = near.p1.screen.x - near.p1.screen.w;
        const r = near.p1.screen.x + near.p1.screen.w;
        const lPrev = near.p2.screen.x - near.p2.screen.w;
        const rPrev = near.p2.screen.x + near.p2.screen.w;
        const le = l + (l - lPrev) * t;
        const re = r + (r - rPrev) * t;
        renderSegment(
          ctx, width,
          (le + re) / 2, height, (re - le) / 2,
          near.p1.screen.x, near.p1.screen.y, near.p1.screen.w,
          near.dark ? PALETTE.dark : PALETTE.light,
        );
      }
    }

    for (const segment of drawable) {
      let colour = segment.dark ? PALETTE.dark : PALETTE.light;
      if (segment.startLine) colour = segment.dark ? PALETTE.start : PALETTE.startAlt;
      else if (segment.checkpoint >= 0) colour = PALETTE.checkpoint;

      renderSegment(
        ctx, width,
        segment.p1.screen.x, segment.p1.screen.y, segment.p1.screen.w,
        segment.p2.screen.x, segment.p2.screen.y, segment.p2.screen.w,
        colour,
      );
    }

    // Fog: one pass over the far half of the road, strongest at the horizon.
    const fog = ctx.createLinearGradient(0, horizonY - height * 0.02, 0, horizonY + height * 0.22);
    fog.addColorStop(0, PALETTE.fog);
    fog.addColorStop(1, "rgba(58,35,96,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, horizonY - height * 0.02, width, height * 0.26);

    // --- traffic and scenery, far to near ---------------------------------
    const bucket = new Map();
    for (const car of state.traffic) {
      if (!car.active) continue;
      const i = Math.floor(mod(car.z, track.trackLength) / SEGMENT_LENGTH);
      if (!bucket.has(i)) bucket.set(i, []);
      bucket.get(i).push(car);
    }

    for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
      const segment = segments[(baseSegment.index + n) % segments.length];
      if (segment.p1.screen.scale === undefined) continue;

      for (const item of segment.sprites) {
        const s = sprites.scenery[item.source];
        if (!s) continue;
        renderSprite(
          ctx, width, ROAD_WIDTH, s,
          segment.p1.screen.scale,
          segment.p1.screen.x + segment.p1.screen.w * item.offset,
          segment.p1.screen.y,
          item.offset < 0 ? -1 : 0, -1,
          segment.clip,
        );
      }

      for (const car of bucket.get(segment.index) ?? []) {
        const percent = mod(car.z, SEGMENT_LENGTH) / SEGMENT_LENGTH;
        const scale = segment.p1.screen.scale + (segment.p2.screen.scale - segment.p1.screen.scale) * percent;
        const sx = segment.p1.screen.x + (segment.p2.screen.x - segment.p1.screen.x) * percent;
        const sy = segment.p1.screen.y + (segment.p2.screen.y - segment.p1.screen.y) * percent;
        const sw = segment.p1.screen.w + (segment.p2.screen.w - segment.p1.screen.w) * percent;
        renderSprite(
          ctx, width, ROAD_WIDTH, sprites.cars[car.sprite % sprites.cars.length],
          scale, sx + sw * car.offset, sy, -0.5, -1, segment.clip,
        );
      }
    }

    // --- the player -------------------------------------------------------
    const speedPercent = state.speed / MAX_SPEED;
    const bounce = view.bounce;
    const steer = view.steer;
    const key = `${steer < -0.25 ? "left" : steer > 0.25 ? "right" : "straight"}${view.braking ? "Brake" : ""}`;
    const playerSprite = sprites.player[key] ?? sprites.player.straight;
    const scale = CAMERA_DEPTH / PLAYER_Z;
    renderSprite(
      ctx, width, ROAD_WIDTH, playerSprite, scale,
      width / 2,
      playerScreenY + bounce,
      -0.5, -1, 0,
    );

    // Speed streaks radiate from the vanishing point, which is what reads as
    // travelling rather than as scratches on the lens. They squash vertically
    // so they follow the road's perspective instead of forming a circle.
    if (speedPercent > 0.5) {
      const a = (speedPercent - 0.5) / 0.5;
      ctx.save();
      ctx.globalAlpha = a * 0.16;
      ctx.strokeStyle = "#d4ecff";
      ctx.lineCap = "round";
      ctx.lineWidth = 1 + a * 1.1;
      const vx = width / 2;
      const vy = horizonY;
      for (let i = 0; i < 20; i++) {
        const t = (i * 0.618034 + view.streakPhase) % 1;
        const angle = t * Math.PI * 2;
        const r0 = height * (0.62 + 0.5 * ((i * 0.37 + view.streakPhase * 1.7) % 1));
        const len = height * 0.085 * a * (0.45 + t);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle) * 0.52;
        ctx.beginPath();
        ctx.moveTo(vx + cos * r0, vy + sin * r0);
        ctx.lineTo(vx + cos * (r0 + len), vy + sin * (r0 + len));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Off-road dust
    if (state.offRoad && state.speed > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#d9c9a8";
      ctx.fillRect(0, height * 0.82, width, height * 0.18);
      ctx.restore();
    }

    // Vignette, last, over everything.
    const vig = ctx.createRadialGradient(
      width / 2, height * 0.55, height * 0.25,
      width / 2, height * 0.55, height * 0.85,
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(8,4,20,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  }

  return { resize, render, get width() { return width; }, get height() { return height; } };
}

export { FONT };
