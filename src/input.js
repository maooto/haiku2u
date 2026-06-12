// Unified input: Bluetooth/USB gamepads (Gamepad API), pointer-lock or drag
// mouse, and keyboard. Produces a per-frame look delta plus edge-triggered
// "select" / "mono" actions, and surfaces controller connect/disconnect info.

const STICK_DEADZONE = 0.18;
const STICK_RATE = 1.7; // rad/s at full deflection
const KEY_RATE = 1.1; // rad/s
const MOUSE_SENS = 0.0021; // rad/px

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.look = { x: 0, y: 0 }; // radians this frame (yaw, pitch)
    this.pad = null;
    this.padStyle = 'generic';
    this._prevButtons = [];
    this._select = false;
    this._mono = false;
    this._keys = new Set();
    this._mouseAccum = { x: 0, y: 0 };
    this._dragging = false;
    this._downPos = null;
    this._gestureCbs = [];
    this._padCbs = [];
    this._gestureFired = false;
    this.lockEnabled = false;

    window.addEventListener('gamepadconnected', (e) => {
      this._adoptPad(e.gamepad);
      this._fireGesture();
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.pad && e.gamepad.index === this.pad.index) {
        this.pad = null;
        this._emitPad('disconnected', 'controller disconnected');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._fireGesture();
      const k = e.key.toLowerCase();
      if (k === 'enter' || k === ' ') this._select = true;
      if (k === 'm') this._mono = true;
      this._keys.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.key.toLowerCase()));

    canvas.addEventListener('mousedown', (e) => {
      this._fireGesture();
      this._downPos = { x: e.clientX, y: e.clientY };
      this._dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this._mouseAccum.x += e.movementX * MOUSE_SENS;
        this._mouseAccum.y += e.movementY * MOUSE_SENS;
      } else if (this._downPos) {
        const dx = e.clientX - this._downPos.x;
        const dy = e.clientY - this._downPos.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this._dragging = true;
        this._mouseAccum.x += e.movementX * MOUSE_SENS * 1.4;
        this._mouseAccum.y += e.movementY * MOUSE_SENS * 1.4;
      }
    });
    window.addEventListener('mouseup', () => {
      if (this._downPos && !this._dragging) {
        if (document.pointerLockElement === this.canvas) {
          this._select = true;
        } else if (this.lockEnabled) {
          // first click captures the mouse; later clicks select
          this.canvas.requestPointerLock?.();
          this._select = true; // also allow direct click-select when lock is denied
        } else {
          this._select = true;
        }
      }
      this._downPos = null;
      this._dragging = false;
    });
  }

  onGesture(cb) {
    this._gestureCbs.push(cb);
  }

  onPad(cb) {
    this._padCbs.push(cb);
  }

  _fireGesture() {
    if (this._gestureFired) return;
    this._gestureFired = true;
    for (const cb of this._gestureCbs) cb();
  }

  _emitPad(type, msg) {
    for (const cb of this._padCbs) cb(type, msg);
  }

  _adoptPad(gp) {
    if (this.pad && this.pad.index === gp.index) return;
    this.pad = gp;
    const id = gp.id.toLowerCase();
    this.padStyle = /playstation|dualshock|dualsense|sony|054c/.test(id)
      ? 'ps'
      : /xbox|xinput|045e|microsoft/.test(id)
        ? 'xbox'
        : 'generic';
    const label =
      this.padStyle === 'ps' ? 'PlayStation controller' : this.padStyle === 'xbox' ? 'Xbox controller' : 'controller';
    this._emitPad('connected', `${label} connected`);
  }

  get selectGlyph() {
    return this.padStyle === 'ps' ? '✕' : 'A';
  }

  update(dt) {
    let lx = 0;
    let ly = 0;

    // ----- gamepad -----
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) {
      if (!p) continue;
      if (this.pad && p.index === this.pad.index) {
        gp = p;
        break;
      }
      if (!gp) gp = p;
    }
    if (gp) {
      if (!this.pad || this.pad.index !== gp.index) this._adoptPad(gp);
      this.pad = gp;

      const axis = (v) => (Math.abs(v) < STICK_DEADZONE ? 0 : Math.sign(v) * ((Math.abs(v) - STICK_DEADZONE) / (1 - STICK_DEADZONE)) ** 1.6);
      // either stick pans the view
      const ax = axis(gp.axes[0] ?? 0) + axis(gp.axes[2] ?? 0);
      const ay = axis(gp.axes[1] ?? 0) + axis(gp.axes[3] ?? 0);
      lx += ax * STICK_RATE * dt;
      ly += ay * STICK_RATE * dt;

      // d-pad nudges
      if (gp.buttons[14]?.pressed) lx -= STICK_RATE * 0.55 * dt;
      if (gp.buttons[15]?.pressed) lx += STICK_RATE * 0.55 * dt;
      if (gp.buttons[12]?.pressed) ly -= STICK_RATE * 0.55 * dt;
      if (gp.buttons[13]?.pressed) ly += STICK_RATE * 0.55 * dt;

      // edge-triggered buttons
      const pressed = (i) => !!gp.buttons[i]?.pressed;
      const was = (i) => !!this._prevButtons[i];
      let any = false;
      for (let i = 0; i < gp.buttons.length; i++) if (pressed(i) && !was(i)) any = true;
      if (any) this._fireGesture();
      if ((pressed(0) && !was(0)) || (pressed(9) && !was(9))) this._select = true;
      if (pressed(8) && !was(8)) this._mono = true;
      this._prevButtons = gp.buttons.map((b) => b.pressed);
    } else {
      this._prevButtons = [];
    }

    // ----- keyboard held keys -----
    const k = this._keys;
    if (k.has('arrowleft') || k.has('a')) lx -= KEY_RATE * dt;
    if (k.has('arrowright') || k.has('d')) lx += KEY_RATE * dt;
    if (k.has('arrowup') || k.has('w')) ly -= KEY_RATE * dt;
    if (k.has('arrowdown') || k.has('s')) ly += KEY_RATE * dt;

    // ----- mouse accumulated since last frame -----
    lx += this._mouseAccum.x;
    ly += this._mouseAccum.y;
    this._mouseAccum.x = 0;
    this._mouseAccum.y = 0;

    this.look.x = lx;
    this.look.y = ly;
  }

  consumeSelect() {
    const v = this._select;
    this._select = false;
    return v;
  }

  consumeMono() {
    const v = this._mono;
    this._mono = false;
    return v;
  }

  rumble(strong = 0.4, weak = 0.6, ms = 120) {
    const act = this.pad?.vibrationActuator;
    if (!act) return;
    try {
      act.playEffect?.('dual-rumble', {
        startDelay: 0,
        duration: ms,
        strongMagnitude: strong,
        weakMagnitude: weak,
      })?.catch?.(() => {});
    } catch {
      /* rumble is best-effort */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }
}
