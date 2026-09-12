// Engine note, tyre noise and one-shot effects, synthesised in Web Audio.
//
// Nothing here is created until the player's first input: an AudioContext built
// before a gesture starts suspended, and every later sound is silently dropped.

import { MAX_SPEED } from "./sim/config.js";

export function createAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    buildEngine();
    return ctx;
  }

  function noiseBuffer(seconds = 2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildEngine() {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 4;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    // Tyre and wind noise, filtered up as speed rises.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer();
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;

    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(master);
    noise.connect(noiseFilter).connect(noiseGain).connect(master);

    osc.start();
    sub.start();
    noise.start();
    engine = { osc, sub, filter, gain, noiseFilter, noiseGain };
  }

  function blip(freq, duration, type = "triangle", volume = 0.3) {
    if (!ensure() || muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    /** Call from a real user gesture. */
    unlock() {
      ensure();
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.02);
    },
    get muted() {
      return muted;
    },
    /** Follow the car. Called every frame; all ramps are short and smooth. */
    update(speed, { offRoad = false, running = true } = {}) {
      if (!ctx || !engine) return;
      const t = ctx.currentTime;
      const pct = Math.min(1, Math.max(0, speed / MAX_SPEED));
      const level = running ? 1 : 0;
      engine.osc.frequency.setTargetAtTime(55 + pct * 210, t, 0.06);
      engine.sub.frequency.setTargetAtTime(27 + pct * 100, t, 0.06);
      engine.filter.frequency.setTargetAtTime(420 + pct * 2400, t, 0.08);
      engine.gain.gain.setTargetAtTime(level * (0.05 + pct * 0.16), t, 0.08);
      engine.noiseFilter.frequency.setTargetAtTime(500 + pct * 2600, t, 0.1);
      engine.noiseGain.gain.setTargetAtTime(level * pct * (offRoad ? 0.14 : 0.035), t, 0.08);
    },
    crash() {
      if (!ensure() || muted) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2200, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      src.connect(filter).connect(gain).connect(master);
      src.start();
      src.stop(ctx.currentTime + 0.5);
    },
    pass() {
      blip(880, 0.09, "sine", 0.13);
    },
    checkpoint() {
      blip(660, 0.14, "triangle", 0.26);
      setTimeout(() => blip(990, 0.2, "triangle", 0.26), 90);
    },
    lap() {
      blip(523, 0.12, "square", 0.2);
      setTimeout(() => blip(784, 0.12, "square", 0.2), 110);
      setTimeout(() => blip(1046, 0.28, "square", 0.22), 220);
    },
    gameOver() {
      blip(330, 0.3, "sawtooth", 0.24);
      setTimeout(() => blip(247, 0.5, "sawtooth", 0.24), 220);
    },
    countdown(final = false) {
      blip(final ? 1046 : 523, final ? 0.4 : 0.16, "triangle", 0.3);
    },
  };
}
