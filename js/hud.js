// The DOM overlay.
//
// Two rules shape this module. Discrete state changes are pushed to the page
// from the handler that caused them, never from the animation loop: a
// visibilitychange handler that pauses and then waits for a frame to show the
// panel can never show it, because becoming hidden is what stopped the frames.
// And effects expire on wall-clock time, not on a frame count, so a toast does
// not freeze mid-flight on a backgrounded tab.

import { CLOCK_MAX, UNITS_PER_METRE } from "./sim/config.js";
import { formatTime } from "./sim/util.js";

const TOAST_MS = 1500;
const TOAST_OUT_MS = 350;
const MAX_TOASTS = 4;

export function createHud(root) {
  const $ = (id) => root.querySelector(`#${id}`);
  const el = {
    hud: $("hud"),
    lapNumber: $("lap-number"),
    lapTime: $("lap-time"),
    bestLap: $("best-lap"),
    clockCell: root.querySelector(".hud-clock"),
    clock: $("clock"),
    clockBar: $("clock-bar"),
    score: $("score"),
    multiplier: $("multiplier"),
    speed: $("speed"),
    streak: $("streak"),
    toasts: $("toasts"),
    countdown: $("countdown"),
    pads: $("pads"),
    pause: $("btn-pause"),
    mute: $("btn-mute"),
    panels: {
      title: $("panel-title"),
      paused: $("panel-paused"),
      over: $("panel-over"),
    },
  };

  const live = [];
  let lastClockText = "";
  let lastScoreText = "";

  function setScreen(phase) {
    for (const [name, node] of Object.entries(el.panels)) {
      node.hidden = name !== phase;
    }
    const racing = phase === "racing" || phase === "countdown";
    el.hud.hidden = !racing;
    el.pause.hidden = phase !== "racing";
    if (phase !== "countdown") {
      el.countdown.hidden = true;
      el.countdown.textContent = "";
    }
  }

  function showCountdown(text) {
    el.countdown.hidden = text === null;
    el.countdown.textContent = text ?? "";
  }

  function toast(text, kind = "") {
    const node = document.createElement("div");
    node.className = `toast${kind ? ` ${kind}` : ""}`;
    node.textContent = text;
    el.toasts.prepend(node);
    live.push({ node, die: performance.now() + TOAST_MS });
    while (live.length > MAX_TOASTS) {
      const oldest = live.shift();
      oldest.node.remove();
    }
  }

  function tickToasts(now) {
    for (let i = live.length - 1; i >= 0; i--) {
      const t = live[i];
      if (now < t.die) continue;
      if (!t.leaving) {
        t.leaving = true;
        t.node.classList.add("leaving");
        t.die = now + TOAST_OUT_MS;
        continue;
      }
      t.node.remove();
      live.splice(i, 1);
    }
  }

  function clearToasts() {
    for (const t of live) t.node.remove();
    live.length = 0;
  }

  /** Values that genuinely change every frame. */
  function syncFrame(s) {
    const clockText = s.clock.toFixed(1);
    if (clockText !== lastClockText) {
      el.clock.textContent = clockText;
      lastClockText = clockText;
    }
    el.clockBar.style.transform = `scaleX(${Math.max(0, Math.min(1, s.clock / CLOCK_MAX))})`;
    el.clockCell.classList.toggle("is-low", s.clock < 8);

    el.speed.textContent = String(Math.round((s.speed / UNITS_PER_METRE) * 3.6));

    const scoreText = Math.round(s.score).toLocaleString("en-US");
    if (scoreText !== lastScoreText) {
      el.score.textContent = scoreText;
      lastScoreText = scoreText;
    }

    el.lapTime.textContent = formatTime(s.lapTime);
    el.lapNumber.textContent = String(s.laps + 1);
    el.bestLap.textContent = Number.isFinite(s.bestLap) ? formatTime(s.bestLap) : "--:--.--";

    const hasStreak = s.streak > 0;
    el.multiplier.hidden = !hasStreak;
    el.streak.hidden = !hasStreak;
    if (hasStreak) {
      el.multiplier.textContent = `×${s.multiplier.toFixed(1)}`;
      el.streak.textContent = `${s.streak} clean pass${s.streak === 1 ? "" : "es"}`;
    }
  }

  function fillSummary(s, record, persistent) {
    $("final-score").textContent = Math.round(s.score).toLocaleString("en-US");
    $("final-distance").textContent = `${Math.round(s.totalDistance / UNITS_PER_METRE).toLocaleString("en-US")} m`;
    $("final-laps").textContent = String(s.laps);
    $("final-bestlap").textContent = Number.isFinite(s.bestLap) ? formatTime(s.bestLap) : "--:--.--";
    $("final-streak").textContent = String(s.bestStreak);

    const note = $("over-record");
    const parts = [];
    if (record.score) parts.push("new best score");
    if (record.bestLap) parts.push("new best lap");
    if (parts.length) {
      note.textContent = `★ ${parts.join(" · ")}`;
      note.hidden = false;
    } else if (!persistent) {
      note.textContent = "Records can't be saved in this browser mode.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function showTitleRecord(best) {
    const node = $("title-record");
    if (!best || best.score <= 0) {
      node.hidden = true;
      return;
    }
    const lap = Number.isFinite(best.bestLap) && best.bestLap !== null ? ` · best lap ${formatTime(best.bestLap)}` : "";
    node.textContent = `Best ${Math.round(best.score).toLocaleString("en-US")} points${lap}`;
    node.hidden = false;
  }

  function setMuted(muted) {
    el.mute.setAttribute("aria-pressed", String(muted));
  }

  function showPads(show) {
    el.pads.hidden = !show;
  }

  return {
    el,
    setScreen,
    showCountdown,
    toast,
    tickToasts,
    clearToasts,
    syncFrame,
    fillSummary,
    showTitleRecord,
    setMuted,
    showPads,
  };
}
