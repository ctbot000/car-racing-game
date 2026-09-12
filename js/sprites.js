// Every sprite in the game is drawn here, in code, onto an offscreen canvas at
// load time. No image files: the repository stays text, the art scales to any
// device pixel ratio, and a colour change is a colour change rather than a
// round trip through an editor.
//
// `worldWidth` is the sprite's width in road-offset units, where the road spans
// -1..1. The renderer turns that into pixels using the projected road width, so
// everything keeps its proportions at every distance.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx };
}

function sprite(w, h, worldWidth, draw) {
  const { canvas, ctx } = surface(w, h);
  draw(ctx, w, h);
  return { canvas, width: w, height: h, worldWidth };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A rear-view car body. `lean` skews it for a steering frame. */
function drawCar(ctx, w, h, opts) {
  const {
    body = "#e8455f",
    roof = "#b02a45",
    glass = "#1b1140",
    lean = 0,
    brake = false,
    headlights = false,
  } = opts;

  const cx = w / 2;
  const bodyW = w * 0.86;
  const bodyH = h * 0.5;
  const bodyY = h * 0.38;
  const skew = lean * w * 0.045;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Contact shadow, drawn as one path so the alpha stays flat rather than
  // compounding where the ellipses overlap.
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.93, bodyW * 0.56, h * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Wheels
  ctx.fillStyle = "#14121c";
  const wheelW = w * 0.14;
  const wheelH = h * 0.2;
  roundRect(ctx, cx - bodyW / 2 - wheelW * 0.28 + skew, h * 0.72, wheelW, wheelH, wheelW * 0.3);
  ctx.fill();
  roundRect(ctx, cx + bodyW / 2 - wheelW * 0.72 + skew, h * 0.72, wheelW, wheelH, wheelW * 0.3);
  ctx.fill();

  // Cabin / roof, narrower than the body and set back
  const roofW = bodyW * 0.68;
  const grad = ctx.createLinearGradient(0, bodyY - h * 0.22, 0, bodyY + bodyH);
  grad.addColorStop(0, roof);
  grad.addColorStop(0.55, body);
  grad.addColorStop(1, roof);
  ctx.fillStyle = grad;
  roundRect(ctx, cx - roofW / 2 + skew * 1.6, h * 0.16, roofW, h * 0.3, w * 0.06);
  ctx.fill();

  // Rear window
  ctx.fillStyle = glass;
  roundRect(ctx, cx - roofW / 2 + w * 0.045 + skew * 1.6, h * 0.2, roofW - w * 0.09, h * 0.16, w * 0.03);
  ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#9fe9ff";
  roundRect(ctx, cx - roofW / 2 + w * 0.055 + skew * 1.6, h * 0.21, (roofW - w * 0.09) * 0.45, h * 0.12, w * 0.02);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Main body
  ctx.fillStyle = grad;
  roundRect(ctx, cx - bodyW / 2 + skew, bodyY, bodyW, bodyH, w * 0.07);
  ctx.fill();

  // Rear bumper
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  roundRect(ctx, cx - bodyW / 2 + skew, bodyY + bodyH * 0.68, bodyW, bodyH * 0.3, w * 0.05);
  ctx.fill();

  // Tail lights. The glow is one translucent pass under a solid core, so it
  // reads as light rather than as a lighter rectangle.
  const lightW = bodyW * 0.24;
  const lightH = h * 0.075;
  const lightY = bodyY + bodyH * 0.26;
  const hot = brake ? "#ff3a3a" : "#d4243a";
  ctx.save();
  ctx.shadowColor = hot;
  ctx.shadowBlur = brake ? w * 0.3 : w * 0.12;
  ctx.fillStyle = hot;
  for (const side of [-1, 1]) {
    roundRect(ctx, cx + side * bodyW * 0.36 - lightW / 2 + skew, lightY, lightW, lightH, lightH * 0.4);
    ctx.fill();
  }
  ctx.restore();
  if (brake) {
    ctx.fillStyle = "rgba(255,220,220,0.9)";
    for (const side of [-1, 1]) {
      roundRect(ctx, cx + side * bodyW * 0.36 - lightW * 0.3 + skew, lightY + lightH * 0.22, lightW * 0.6, lightH * 0.5, lightH * 0.25);
      ctx.fill();
    }
  }

  if (headlights) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#fff6d8";
    ctx.beginPath();
    ctx.ellipse(cx + skew, h * 0.98, bodyW * 0.6, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

const TRAFFIC_COLOURS = [
  { body: "#3fb9ff", roof: "#1d6fae" },
  { body: "#f7c948", roof: "#b8860b" },
  { body: "#8b5cf6", roof: "#5b32b5" },
  { body: "#f2f4f8", roof: "#aab2c0" },
  { body: "#2ee6a8", roof: "#12886a" },
];

function drawPalm(ctx, w, h, { tall = false } = {}) {
  const trunkBase = w * 0.5;
  const bend = w * (tall ? 0.14 : 0.1);
  const top = h * (tall ? 0.18 : 0.26);

  ctx.strokeStyle = "#3a2b4d";
  ctx.lineWidth = w * 0.07;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(trunkBase, h);
  ctx.quadraticCurveTo(trunkBase + bend, h * 0.6, trunkBase + bend * 1.6, top);
  ctx.stroke();

  // Trunk rings
  ctx.lineWidth = w * 0.02;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    const x = trunkBase + bend * t * 1.6;
    const y = h - (h - top) * t;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.03, y);
    ctx.lineTo(x + w * 0.03, y);
    ctx.stroke();
  }

  // Fronds: one path per frond so each keeps its own silhouette.
  const cx = trunkBase + bend * 1.6;
  const cy = top;
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + 0.3;
    const len = w * (0.3 + 0.14 * Math.sin(i * 2.1));
    const droop = Math.abs(Math.cos(a)) * len * 0.55;
    ctx.fillStyle = i % 2 ? "#1f6f52" : "#2b8f66";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + Math.cos(a) * len * 0.6,
      cy + Math.sin(a) * len * 0.35 - len * 0.18,
      cx + Math.cos(a) * len,
      cy + Math.sin(a) * len * 0.4 + droop,
    );
    ctx.quadraticCurveTo(
      cx + Math.cos(a) * len * 0.55,
      cy + Math.sin(a) * len * 0.3 + len * 0.06,
      cx,
      cy,
    );
    ctx.fill();
  }
  ctx.fillStyle = "#123f31";
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx, w, h) {
  // One path, one fill: overlapping blobs filled separately would show every
  // internal seam at this alpha.
  ctx.fillStyle = "#1d5c46";
  ctx.beginPath();
  const blobs = [
    [0.3, 0.72, 0.26],
    [0.55, 0.62, 0.3],
    [0.75, 0.76, 0.22],
    [0.45, 0.82, 0.24],
  ];
  for (const [x, y, r] of blobs) {
    ctx.moveTo((x + r) * w, y * h);
    ctx.arc(x * w, y * h, r * w, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = "rgba(120,230,180,0.18)";
  ctx.beginPath();
  ctx.ellipse(w * 0.48, h * 0.58, w * 0.24, h * 0.1, -0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoulder(ctx, w, h) {
  ctx.fillStyle = "#3b3350";
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h);
  ctx.lineTo(w * 0.2, h * 0.5);
  ctx.lineTo(w * 0.45, h * 0.3);
  ctx.lineTo(w * 0.72, h * 0.42);
  ctx.lineTo(w * 0.9, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#544a70";
  ctx.beginPath();
  ctx.moveTo(w * 0.2, h * 0.5);
  ctx.lineTo(w * 0.45, h * 0.3);
  ctx.lineTo(w * 0.6, h * 0.52);
  ctx.lineTo(w * 0.33, h * 0.66);
  ctx.closePath();
  ctx.fill();
}

function drawBillboard(ctx, w, h) {
  ctx.fillStyle = "#241c38";
  ctx.fillRect(w * 0.45, h * 0.45, w * 0.05, h * 0.55);
  ctx.fillRect(w * 0.5, h * 0.45, w * 0.05, h * 0.55);

  const bx = w * 0.08;
  const by = h * 0.06;
  const bw = w * 0.84;
  const bh = h * 0.42;
  ctx.fillStyle = "#150f26";
  roundRect(ctx, bx, by, bw, bh, w * 0.02);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = "#ff3ea5";
  ctx.shadowBlur = w * 0.06;
  ctx.strokeStyle = "#ff3ea5";
  ctx.lineWidth = w * 0.018;
  roundRect(ctx, bx + w * 0.02, by + h * 0.03, bw - w * 0.04, bh - h * 0.06, w * 0.015);
  ctx.stroke();
  ctx.restore();

  // Font strings are built from a JS constant: a CSS custom property here is a
  // parse failure the context ignores, leaving whatever font was set last.
  ctx.fillStyle = "#6ff0ff";
  ctx.font = `700 ${Math.round(h * 0.17)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SUNSET", w * 0.5, by + bh * 0.35);
  ctx.fillStyle = "#ffd166";
  ctx.font = `700 ${Math.round(h * 0.12)}px ${FONT}`;
  ctx.fillText("CIRCUIT", w * 0.5, by + bh * 0.68);
}

function drawLamp(ctx, w, h) {
  ctx.strokeStyle = "#2e2745";
  ctx.lineWidth = w * 0.09;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(w * 0.78, h);
  ctx.lineTo(w * 0.78, h * 0.16);
  ctx.quadraticCurveTo(w * 0.78, h * 0.07, w * 0.42, h * 0.07);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = "#ffb347";
  ctx.shadowBlur = w * 0.5;
  ctx.fillStyle = "#ffd9a0";
  roundRect(ctx, w * 0.28, h * 0.05, w * 0.24, h * 0.055, w * 0.03);
  ctx.fill();
  ctx.restore();

  // A soft wash rather than a solid cone: at any real opacity a flat triangle
  // over dark grass reads as a grey pyramid standing in the field.
  const cone = ctx.createLinearGradient(0, h * 0.1, 0, h);
  cone.addColorStop(0, "rgba(255,179,71,0.16)");
  cone.addColorStop(1, "rgba(255,179,71,0)");
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(w * 0.4, h * 0.1);
  ctx.lineTo(w * 0.12, h);
  ctx.lineTo(w * 0.72, h);
  ctx.closePath();
  ctx.fill();
}

function drawPost(ctx, w, h) {
  ctx.fillStyle = "#e6e9f5";
  roundRect(ctx, w * 0.42, h * 0.25, w * 0.16, h * 0.75, w * 0.06);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = "#ff5470";
  ctx.shadowBlur = w * 0.5;
  ctx.fillStyle = "#ff5470";
  roundRect(ctx, w * 0.42, h * 0.32, w * 0.16, h * 0.14, w * 0.05);
  ctx.fill();
  ctx.restore();
}

/** Build every sprite once. Call after the document exists. */
export function buildSprites() {
  const cars = TRAFFIC_COLOURS.map((c) =>
    sprite(200, 150, 0.34, (ctx, w, h) => drawCar(ctx, w, h, { ...c, headlights: true })),
  );

  const player = {};
  for (const [name, lean] of [["straight", 0], ["left", -1], ["right", 1]]) {
    for (const brake of [false, true]) {
      player[`${name}${brake ? "Brake" : ""}`] = sprite(240, 180, 0.36, (ctx, w, h) =>
        drawCar(ctx, w, h, { body: "#ff4d6d", roof: "#a81f45", lean, brake }),
      );
    }
  }

  return {
    cars,
    player,
    scenery: {
      palm: sprite(260, 380, 0.72, (ctx, w, h) => drawPalm(ctx, w, h)),
      palmTall: sprite(280, 520, 0.88, (ctx, w, h) => drawPalm(ctx, w, h, { tall: true })),
      bush: sprite(200, 140, 0.46, drawBush),
      boulder: sprite(220, 160, 0.56, drawBoulder),
      billboard: sprite(360, 300, 1.25, drawBillboard),
      lamp: sprite(200, 420, 0.5, drawLamp),
      post: sprite(80, 130, 0.14, drawPost),
    },
  };
}

export { TRAFFIC_COLOURS };
