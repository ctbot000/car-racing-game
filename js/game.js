// Glue: owns the phase machine, the fixed-timestep loop and the reaction to
// simulation events. Everything it drives (sim, renderer, hud, audio, input)
// is a separate module; this file only decides when.

import { createSim, startSim, stepSim, STATUS } from "./sim/sim.js";
import { FIXED_STEP, MAX_SPEED, PLAYER_Z, UNITS_PER_METRE, CLOCK_MAX } from "./sim/config.js";
import { findSegment } from "./sim/track.js";
import { clamp, formatTime } from "./sim/util.js";
import { createRenderer, MIN_ASPECT, MAX_ASPECT } from "./render.js";
import { buildSprites } from "./sprites.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createAudio } from "./audio.js";
import { best, recordRun, isPersistent } from "./storage.js";

const PHASE = { TITLE: "title", COUNTDOWN: "countdown", RACING: "racing", PAUSED: "paused", OVER: "over" };
const COUNTDOWN_STEPS = ["3", "2", "1", "GO"];
const COUNTDOWN_MS = 700;
const TRACK_SEED = 1;
const MAX_CATCHUP = 0.1; // seconds of simulation a single frame may make up

export function createGame(root) {
  const canvas = root.querySelector("#view");
  const stage = root.querySelector("#stage");
  const renderer = createRenderer(canvas);
  const hud = createHud(root);
  const input = createInput(root);
  const audio = createAudio();
  const sprites = buildSprites();

  let sim = createSim({ seed: 1, trackSeed: TRACK_SEED });
  let phase = PHASE.TITLE;
  let accumulator = 0;
  let last = 0;
  let running = false;
  let countdownIndex = 0;
  let countdownAt = 0;
  let audioUnlocked = false;

  const view = {
    bounce: 0,
    steer: 0,
    braking: false,
    curveOffset: 0,
    pitch: 0,
    streakPhase: 0,
  };

  // --- phase ---------------------------------------------------------------
  // Every transition paints synchronously. Waiting for the next frame to show
  // a panel fails exactly when frames are scarce, which is when it matters.

  function setPhase(next) {
    phase = next;
    hud.setScreen(next);
    if (next !== PHASE.RACING) {
      audio.update(0, { running: false });
    }
    if (next === PHASE.TITLE) {
      hud.showTitleRecord(best());
    }
  }

  function newRace() {
    sim = createSim({ seed: (Math.random() * 0xffffffff) >>> 0, trackSeed: TRACK_SEED });
    accumulator = 0;
    countdownIndex = 0;
    countdownAt = performance.now();
    hud.clearToasts();
    hud.syncFrame(sim);
    setPhase(PHASE.COUNTDOWN);
    hud.showCountdown(COUNTDOWN_STEPS[0]);
    audio.countdown(false);
    ensureLoop();
  }

  function pause() {
    if (phase !== PHASE.RACING) return;
    setPhase(PHASE.PAUSED);
  }

  function resume() {
    if (phase !== PHASE.PAUSED) return;
    setPhase(PHASE.RACING);
    // The clock restarts from now; without this the whole pause arrives as one
    // delta and the first frame teleports the car.
    last = performance.now();
    ensureLoop();
  }

  function finish() {
    const record = recordRun({
      score: sim.score,
      distance: sim.totalDistance,
      laps: sim.laps,
      bestLap: Number.isFinite(sim.bestLap) ? sim.bestLap : null,
      streak: sim.bestStreak,
    });
    hud.fillSummary(sim, record, isPersistent());
    setPhase(PHASE.OVER);
    audio.gameOver();
  }

  function giveUp() {
    if (phase !== PHASE.PAUSED) return;
    finish();
  }

  // --- events from the simulation -----------------------------------------

  function handle(events) {
    for (const e of events) {
      switch (e.type) {
        case "nearmiss":
          audio.pass();
          if (e.streak % 5 === 0) hud.toast(`${e.streak} clean · ×${e.multiplier.toFixed(1)}`);
          break;
        case "checkpoint":
          audio.checkpoint();
          hud.toast(`Checkpoint +${e.gained.toFixed(1)}s`, "gain");
          break;
        case "lap":
          audio.lap();
          hud.toast(
            e.time === e.best ? `Lap ${e.lap} · best ${formatTime(e.time)}` : `Lap ${e.lap} · ${formatTime(e.time)}`,
            "gain",
          );
          break;
        case "collision":
          audio.crash();
          hud.toast("Crash", "bad");
          break;
        case "gameover":
          finish();
          break;
      }
    }
  }

  // --- the loop ------------------------------------------------------------

  function ensureLoop() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    // A long stall must not be replayed as one enormous step; clamp it and
    // accept that the simulation falls behind the wall clock instead.
    const elapsed = Math.min(MAX_CATCHUP, Math.max(0, (now - last) / 1000));
    last = now;

    if (phase === PHASE.COUNTDOWN) {
      if (now - countdownAt >= COUNTDOWN_MS) {
        countdownAt = now;
        countdownIndex++;
        if (countdownIndex >= COUNTDOWN_STEPS.length) {
          hud.showCountdown(null);
          startSim(sim);
          setPhase(PHASE.RACING);
        } else {
          hud.showCountdown(COUNTDOWN_STEPS[countdownIndex]);
          audio.countdown(countdownIndex === COUNTDOWN_STEPS.length - 1);
        }
      }
    }

    if (phase === PHASE.RACING) {
      const command = input.read();
      view.braking = command.brake && sim.speed > 0;
      view.steer = (command.right ? 1 : 0) - (command.left ? 1 : 0);

      accumulator += elapsed;
      let guard = 0;
      while (accumulator >= FIXED_STEP && guard++ < 8) {
        handle(stepSim(sim, command, FIXED_STEP));
        accumulator -= FIXED_STEP;
        if (sim.status !== STATUS.RACING) break;
      }
      hud.syncFrame(sim);
      audio.update(sim.speed, { offRoad: sim.offRoad, running: true });
    }

    updateView(elapsed, now);
    renderer.render(sim, sprites, view);
    hud.tickToasts(now);

    if (phase === PHASE.PAUSED || phase === PHASE.TITLE || phase === PHASE.OVER) {
      // Nothing is moving; stop burning frames until something changes.
      running = false;
      return;
    }
    requestAnimationFrame(frame);
  }

  function updateView(dt, now) {
    const speedPercent = sim.speed / MAX_SPEED;
    const segment = findSegment(sim.track, sim.position + PLAYER_Z);

    // Background parallax follows the curve the car is actually being pushed by.
    view.curveOffset += segment.curve * speedPercent * dt * 220;
    view.pitch = clamp((segment.p2.world.y - segment.p1.world.y) / 900, -1, 1);
    view.streakPhase = (now / 90) % 1;

    const jitter = sim.offRoad ? 3.2 : 1;
    view.bounce =
      Math.sin(now / 42) * speedPercent * jitter * 2.4 + (Math.random() - 0.5) * speedPercent * jitter * 2;

    // Crash shake rides on the canvas transform rather than the draw calls: the
    // stage clips it, so no gap opens at the edges.
    const shake = sim.shake;
    if (shake > 0.001) {
      const k = shake * 14;
      canvas.style.transform = `translate(${(Math.random() - 0.5) * k}px, ${(Math.random() - 0.5) * k}px) scale(1.03)`;
    } else if (canvas.style.transform) {
      canvas.style.transform = "";
    }
  }

  // --- layout --------------------------------------------------------------
  //
  // The stage fills whatever room the page has, within the aspect range the
  // renderer frames well. Both bounds are real, so the size is computed here
  // rather than declared: `aspect-ratio` is inert once an element's two axes
  // are both definite, which is what a growing flex item makes them.

  function layout() {
    const host = stage.parentElement;
    const rect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

    // A surface measured while hidden reports zero, and nothing derived from a
    // zero can be rescaled back. Floor it instead.
    const availW = Math.max(320, Math.floor(rect.width - padX));
    const availH = Math.max(200, Math.floor(rect.height - padY));

    // Fill the room available, within a range the renderer can frame sensibly:
    // beyond it the stage letterboxes rather than showing a slot of road.
    const aspect = clamp(availW / availH, MIN_ASPECT, MAX_ASPECT);
    let w = availW;
    let h = Math.round(w / aspect);
    if (h > availH) {
      h = availH;
      w = Math.round(h * aspect);
    }

    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.resize(w, h, dpr);
    if (!running) renderer.render(sim, sprites, view);
  }

  // --- wiring --------------------------------------------------------------

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audio.unlock();
  }

  root.querySelector("#btn-start").addEventListener("click", () => {
    unlockAudio();
    newRace();
  });
  root.querySelector("#btn-again").addEventListener("click", () => {
    unlockAudio();
    newRace();
  });
  root.querySelector("#btn-resume").addEventListener("click", resume);
  root.querySelector("#btn-quit").addEventListener("click", giveUp);
  root.querySelector("#btn-pause").addEventListener("click", pause);
  root.querySelector("#btn-mute").addEventListener("click", () => {
    unlockAudio();
    audio.setMuted(!audio.muted);
    hud.setMuted(audio.muted);
  });

  input.on("any", unlockAudio);
  input.on("confirm", () => {
    if (phase === PHASE.TITLE || phase === PHASE.OVER) newRace();
    else if (phase === PHASE.PAUSED) resume();
  });
  input.on("restart", () => {
    if (phase === PHASE.RACING || phase === PHASE.PAUSED) newRace();
  });
  input.on("pause", () => {
    if (phase === PHASE.RACING) pause();
    else if (phase === PHASE.PAUSED) resume();
  });
  input.on("mute", () => {
    audio.setMuted(!audio.muted);
    hud.setMuted(audio.muted);
  });

  // Pausing on hide is the sharpest case of the loop-sync trap: becoming
  // hidden is what stops the frames, so the panel has to be painted here.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pause();
      hud.clearToasts();
    }
  });
  window.addEventListener("pointerdown", unlockAudio, { once: true });

  const ro = new ResizeObserver(layout);
  ro.observe(stage.parentElement);
  window.addEventListener("orientationchange", () => setTimeout(layout, 120));

  const coarse = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
  hud.showPads(coarse);
  stage.classList.toggle("has-pads", coarse);

  layout();
  setPhase(PHASE.TITLE);

  return { layout, get phase() { return phase; }, get sim() { return sim; } };
}
