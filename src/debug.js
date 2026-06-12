// Dev/testing hooks, exposed as window.__game. No gameplay effect unless called.
// URL params also work: ?biome=valley|coast|sakura  ?theme=peace  ?skipIntro=1  ?mono=1

export function installDebug(api) {
  window.__game = {
    ...api,
    fakePad: installFakeGamepad,
  };
}

export function urlOptions() {
  const q = new URLSearchParams(location.search);
  return {
    biome: q.get('biome'),
    theme: q.get('theme'),
    skipIntro: q.get('skipIntro') === '1',
    mono: q.get('mono') === '1',
  };
}

// Replaces navigator.getGamepads with a scriptable pad so the gamepad code
// path can be exercised without hardware (the Input class picks it up by
// polling). Returns controls: set axes, press/release buttons.
function installFakeGamepad(id = 'Fake Xbox 360 Controller (XInput STANDARD GAMEPAD)') {
  const pad = {
    id,
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      playEffect: (...args) => {
        console.info('[fakePad] rumble', args[1]);
        return Promise.resolve('complete');
      },
    },
  };
  navigator.getGamepads = () => [pad];
  return {
    pad,
    axes(x0 = 0, y0 = 0, x1 = 0, y1 = 0) {
      pad.axes = [x0, y0, x1, y1];
      pad.timestamp = performance.now();
    },
    press(i) {
      pad.buttons[i] = { pressed: true, touched: true, value: 1 };
      pad.timestamp = performance.now();
    },
    release(i) {
      pad.buttons[i] = { pressed: false, touched: false, value: 0 };
      pad.timestamp = performance.now();
    },
    tap(i, ms = 120) {
      this.press(i);
      setTimeout(() => this.release(i), ms);
    },
  };
}
