// Keyboard, pointer and touch input.
//
// Game keys call preventDefault(). Without it, Space or Enter pressed while a
// focused <button> is on screen runs the handler AND the button's own default
// activation, so one press performs two steps.

const KEY_MAP = {
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "accel", KeyW: "accel",
  ArrowDown: "brake", KeyS: "brake", Space: "brake",
};

// Steering is matched on `code`, so WASD keeps its shape on any layout. The
// mnemonic keys are matched on `key` as well, so P for pause still reaches the
// letter P on a layout where that is not the physical KeyP.
const ACTION_BY_CODE = {
  Enter: "confirm", NumpadEnter: "confirm",
  KeyP: "pause", Escape: "pause",
  KeyM: "mute", KeyR: "restart",
};
const ACTION_BY_KEY = {
  enter: "confirm", p: "pause", escape: "pause", m: "mute", r: "restart",
};

export function createInput(root) {
  const held = { left: false, right: false, accel: false, brake: false };
  const touch = { left: false, right: false, brake: false };
  const listeners = { confirm: [], pause: [], mute: [], restart: [], any: [] };
  let usingTouch = false;

  const emit = (name, ...args) => {
    for (const fn of listeners[name] ?? []) fn(...args);
  };

  function onKeyDown(e) {
    if (e.repeat) {
      if (KEY_MAP[e.code]) e.preventDefault();
      return;
    }
    const dir = KEY_MAP[e.code];
    if (dir) {
      held[dir] = true;
      usingTouch = false;
      e.preventDefault();
      emit("any");
      return;
    }
    const action = ACTION_BY_CODE[e.code] ?? ACTION_BY_KEY[e.key?.toLowerCase()];
    if (action) {
      e.preventDefault();
      emit("any");
      emit(action);
    }
  }

  function onKeyUp(e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      held[dir] = false;
      e.preventDefault();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // A window that loses focus never delivers the keyup, leaving the car
  // steering into the wall until the player clicks back and presses the key.
  window.addEventListener("blur", () => {
    for (const k of Object.keys(held)) held[k] = false;
  });

  function bindPad(el, name) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      touch[name] = true;
      usingTouch = true;
      el.classList.add("is-down");
      emit("any");
    };
    const up = (e) => {
      e.preventDefault();
      touch[name] = false;
      el.classList.remove("is-down");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  bindPad(root.querySelector("[data-pad=left]"), "left");
  bindPad(root.querySelector("[data-pad=right]"), "right");
  bindPad(root.querySelector("[data-pad=brake]"), "brake");

  return {
    on(name, fn) {
      (listeners[name] ??= []).push(fn);
    },
    /** The frame's input. On touch the throttle is automatic; there is nowhere
     *  comfortable to put a fourth thumb. */
    read() {
      const left = held.left || touch.left;
      const right = held.right || touch.right;
      const brake = held.brake || touch.brake;
      const accel = held.accel || (usingTouch && !brake);
      return { left, right, accel, brake };
    },
    get usingTouch() {
      return usingTouch;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },
  };
}
