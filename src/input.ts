/** Keyboard, mouse-drag camera and a touch joystick. Uses e.code so it works with the Korean keyboard layout too. */

export interface InputState {
  /** Move direction in camera space: x = right, y = forward, each -1..1. */
  move: { x: number; y: number };
  run: boolean;
  jump: boolean;
  /** Camera drag deltas since last frame, in pixels. */
  look: { x: number; y: number };
  zoom: number;
}

export function createInput(canvas: HTMLCanvasElement, stickEl: HTMLElement, knobEl: HTMLElement, jumpBtn: HTMLElement) {
  const keys = new Set<string>();
  const state: InputState = { move: { x: 0, y: 0 }, run: false, jump: false, look: { x: 0, y: 0 }, zoom: 0 };
  let jumpQueued = false;
  let enabled = false;

  addEventListener("keydown", (e) => {
    if (!enabled) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "Space" && !e.repeat) jumpQueued = true;
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  // Mouse / pen: drag anywhere on the canvas to turn the camera.
  let dragId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    dragId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragId) return;
    state.look.x += e.clientX - lastX;
    state.look.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = (e: PointerEvent) => {
    if (e.pointerId === dragId) dragId = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.zoom += Math.sign(e.deltaY);
  }, { passive: false });

  // Touch: left half = joystick, right half = camera.
  let stickId: number | null = null;
  let stickX = 0;
  let stickY = 0;
  const stick = { x: 0, y: 0 };
  let camTouch: number | null = null;
  let camX = 0;
  let camY = 0;
  const R = 56;
  canvas.addEventListener("touchstart", (e) => {
    if (!enabled) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.5 && stickId === null) {
        stickId = t.identifier;
        stickX = t.clientX;
        stickY = t.clientY;
        stickEl.style.left = `${stickX}px`;
        stickEl.style.top = `${stickY}px`;
        stickEl.classList.add("active");
        knobEl.style.transform = "translate(-50%, -50%)";
      } else if (camTouch === null) {
        camTouch = t.identifier;
        camX = t.clientX;
        camY = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) {
        let dx = t.clientX - stickX;
        let dy = t.clientY - stickY;
        const len = Math.hypot(dx, dy);
        if (len > R) {
          dx = (dx / len) * R;
          dy = (dy / len) * R;
        }
        stick.x = dx / R;
        stick.y = -dy / R;
        knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (t.identifier === camTouch) {
        state.look.x += (t.clientX - camX) * 1.3;
        state.look.y += (t.clientY - camY) * 1.3;
        camX = t.clientX;
        camY = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const touchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) {
        stickId = null;
        stick.x = stick.y = 0;
        stickEl.classList.remove("active");
      } else if (t.identifier === camTouch) camTouch = null;
    }
  };
  canvas.addEventListener("touchend", touchEnd);
  canvas.addEventListener("touchcancel", touchEnd);
  jumpBtn.addEventListener("touchstart", (e) => {
    jumpQueued = true;
    e.preventDefault();
  }, { passive: false });
  jumpBtn.addEventListener("click", () => (jumpQueued = true));

  const has = (...codes: string[]) => codes.some((c) => keys.has(c));

  return {
    state,
    setEnabled(v: boolean) {
      enabled = v;
      if (!v) {
        keys.clear();
        stick.x = stick.y = 0;
        stickId = null;
        stickEl.classList.remove("active");
      }
    },
    /** Read the current input; call once per frame. */
    poll(): InputState {
      let x = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
      let y = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
      if (!x && !y && (stick.x || stick.y)) {
        x = stick.x;
        y = stick.y;
      }
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      state.move.x = enabled ? x : 0;
      state.move.y = enabled ? y : 0;
      state.run = enabled && (has("ShiftLeft", "ShiftRight") || Math.hypot(stick.x, stick.y) > 0.92);
      state.jump = enabled && jumpQueued;
      jumpQueued = false;
      return state;
    },
    consumeLook() {
      const l = { x: state.look.x, y: state.look.y, zoom: state.zoom };
      state.look.x = state.look.y = 0;
      state.zoom = 0;
      return l;
    },
  };
}
