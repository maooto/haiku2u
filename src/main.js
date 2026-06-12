import './style.css';
import * as THREE from 'three';
import { loadHaiku, parseHaikuCSV, pickRound } from './haiku.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { World } from './world/builder.js';
import { BIOMES, randomBiome } from './world/biomes/index.js';
import { CameraRig, lookPose } from './cameraRig.js';
import { installDebug, urlOptions } from './debug.js';

const BIOME_SEEDS = { valley: 11, coast: 22, sakura: 33 };
const FOCUS_SELECT = 0.085; // rad from view center for a dot to be selectable
const FOCUS_REVEAL = 0.17; // rad where its line begins to appear

// ---------------------------------------------------------------- setup

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 2200);
const rig = new CameraRig(camera);
const ui = new UI();
const audio = new AudioSys();
const input = new Input(canvas);

const opts = urlOptions();
let mono = false;
let world = null;
let biome = null;
let haikuData = null;
let round = null;
let state = 'boot';
let compose = null; // { station, lines, resolve }
let selectWaiter = null;
let skipping = false;
let debugSelect = null;

const haikuPromise = loadHaiku().catch((err) => {
  console.error(err);
  return parseHaikuCSV(''); // falls back to the built-in theme
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

input.onPad((type, msg) => ui.toast(msg));

if (opts.mono) {
  mono = true;
  ui.setMono(true);
}

// ---------------------------------------------------------------- world

function buildWorld(name) {
  if (world) world.dispose();
  biome = BIOMES[name] || randomBiome(biome?.name);
  world = new World(scene, biome, { seed: BIOME_SEEDS[biome.name] ?? 7 });
  // park the camera at the head of the flyover
  const [p0, p1] = world.stations.flyover;
  rig.setPose({ pos: p0, ...lookPose(p0, p1), fov: 58 });
  return world;
}

buildWorld(opts.biome);

// ---------------------------------------------------------------- helpers

// game-time scheduler: waits advance with the loop (and with __game.tick),
// so the game stays coherent in hidden tabs and under manual stepping
let gameTime = 0;
const waiters = [];
const wait = (ms) =>
  new Promise((r) => {
    waiters.push({ at: gameTime + ms / 1000, r });
  });
const waitForSelect = () => new Promise((r) => (selectWaiter = r));

function selectHint() {
  return input.pad
    ? `pan <span class="key">stick</span> · select <span class="key">${input.selectGlyph}</span>`
    : `pan <span class="key">mouse</span> / <span class="key">←→↑↓</span> · select <span class="key">click</span> / <span class="key">Enter</span> · mono <span class="key">M</span>`;
}

// ---------------------------------------------------------------- stages

function composeStage(s) {
  const st = world.stations.stages[s];
  rig.setSeated(st);
  world.showDots(s);
  ui.setDotLines(round.options[s], round.syllables[s]);
  ui.showSyllableHint(s);
  input.lockEnabled = true;
  state = 'compose';
  return new Promise((resolve) => {
    compose = { st, lines: round.options[s], resolve, idx: s };
  });
}

function finishCompose(lineIdx) {
  const line = compose.lines[lineIdx];
  input.rumble(0.25, 0.55, 110);
  world.hideDots();
  ui.clearDotLines();
  compose = null;
  state = 'busy';
  return line;
}

let lastFocused = -1;
function updateCompose() {
  rig.applyLook(input.look.x, input.look.y);
  let best = -1;
  let bestAngle = Infinity;
  const f = {};
  for (let i = 0; i < compose.st.dots.length; i++) {
    rig.focusOf(compose.st.dots[i].pos, f);
    const focus = Math.max(0, 1 - f.angle / FOCUS_SELECT);
    const reveal = Math.max(0, 1 - f.angle / FOCUS_REVEAL) ** 1.25;
    world.setDotFocus(i, focus > 0 ? 0.4 + focus * 0.6 : reveal * 0.25);
    ui.updateDotLabel(i, { x: f.x, y: f.y, opacity: reveal, visible: !f.behind });
    if (f.angle < bestAngle) {
      bestAngle = f.angle;
      best = i;
    }
  }
  const focusedIdx = bestAngle < FOCUS_SELECT ? best : -1;
  if (focusedIdx !== lastFocused && focusedIdx >= 0) audio.koto(focusedIdx * 2, 0, 0.05);
  lastFocused = focusedIdx;

  if (debugSelect != null) {
    const i = debugSelect;
    debugSelect = null;
    compose.resolve(finishCompose(i));
    return;
  }
  if (input.consumeSelect() && focusedIdx >= 0) {
    compose.resolve(finishCompose(focusedIdx));
  }
}

// ---------------------------------------------------------------- a round

async function playRound(firstRound) {
  if (!firstRound) buildWorld(opts.biome);
  round = pickRound(haikuData, opts.theme);
  const st = world.stations;
  const chosen = [];

  // --- flyover ---
  state = 'flyover';
  skipping = false;
  audio.startAmbience(biome.ambience);
  ui.showHint(`skip <span class="key">${input.pad ? input.selectGlyph : 'Enter'}</span>`, 6000);
  ui.fadeTo(0, 3000);
  if (opts.skipIntro) {
    rig.setPose(st.seated);
    await wait(300);
  } else {
    await rig.playPath(st.flyover, { duration: 24, endPose: st.seated, startFov: 60, endFov: st.seated.fov });
  }

  // --- theme reveal ---
  state = 'theme';
  audio.bell();
  await wait(900);
  ui.showThemeCard(round.theme);
  await wait(4600);
  ui.hideThemeCard();
  ui.setTracker(round.theme, []);

  // --- three stages ---
  for (let s = 0; s < 3; s++) {
    if (s === 0) {
      // a visible pan-and-zoom onto the first subject
      await rig.travelTo(st.stages[0], 3.4);
      ui.showHint(selectHint(), 9000);
    } else {
      await ui.fadeTo(1, 1150);
      rig.setPose(st.stages[s]);
      await wait(420);
      ui.fadeTo(0, 1250);
    }
    const line = await composeStage(s);
    chosen.push(line);
    ui.setTracker(round.theme, chosen);
    if (s === 0) audio.flute();
    if (s === 1) audio.woodblocks(2);
  }

  // --- finale: gong, slow zoom out, recitation ---
  state = 'finale';
  input.lockEnabled = false;
  input.exitPointerLock();
  ui.hideSyllableHint();
  ui.hideHint();
  ui.setTracker(null);
  audio.gong();
  audio.duck(0.16, 2);
  await rig.travelTo({ ...st.seated, fov: 50 }, 3.0); // rise out of the micro view
  ui.showPoemCard(round.theme, chosen);
  const flight = rig.playPath(st.finale, {
    duration: 26,
    lookAt: st.finaleLook,
    startFov: 50,
    endFov: 62,
  });
  await wait(2200);
  const recital = audio.recite(chosen, { onLine: (i) => ui.revealPoemLine(i) });
  await Promise.all([flight, recital]);
  await wait(600);
  audio.woodblocks(2);
  await wait(1400);
  await ui.fadeTo(1, 2400);

  // --- end card (poem stays lit over black) ---
  state = 'end';
  audio.duck(0.45, 3);
  ui.showEndPrompt(
    `press ${input.pad ? input.selectGlyph : 'Enter'} to compose another`
  );
  await waitForSelect();
  audio.woodblocks(1);
  ui.hidePoemCard();
  state = 'busy';
}

// ---------------------------------------------------------------- boot

async function start() {
  await new Promise((r) => input.onGesture(r));
  audio.unlock();
  ui.hideTitle();
  haikuData = await haikuPromise;
  let first = true;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await playRound(first);
    first = false;
  }
}

start();

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();

function step(dt) {
  gameTime += dt;
  input.update(dt);

  if (input.consumeMono()) {
    mono = !mono;
    ui.setMono(mono);
  }

  if (state === 'compose' && compose) {
    updateCompose();
  } else if (state === 'flyover') {
    if (!skipping && input.consumeSelect()) {
      skipping = true;
      ui.fadeTo(1, 350).then(() => {
        rig.skipPath();
        ui.fadeTo(0, 1100);
      });
    }
  } else if (state === 'end') {
    if (selectWaiter && input.consumeSelect()) {
      const r = selectWaiter;
      selectWaiter = null;
      r();
    }
  } else {
    input.consumeSelect(); // drain stale presses between states
  }

  // release any due game-time waits
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].at <= gameTime) {
      const { r } = waiters.splice(i, 1)[0];
      r();
    }
  }

  ui.update(dt);
  rig.update(dt);
  world?.update(dt);
  renderer.render(scene, camera);
}

function tick() {
  requestAnimationFrame(tick);
  step(Math.min(clock.getDelta(), 0.05));
}
tick();

// ---------------------------------------------------------------- debug

installDebug({
  // advance the game deterministically (works even in hidden tabs where rAF stalls)
  async tick(seconds = 1, dtStep = 1 / 30) {
    clock.getDelta(); // drain real elapsed time so the next rAF doesn't double-step
    const n = Math.ceil(seconds / dtStep);
    for (let i = 0; i < n; i++) {
      step(dtStep);
      await Promise.resolve(); // let awaited game logic continue between steps
    }
    return state;
  },
  get state() {
    return state;
  },
  get biome() {
    return biome?.name;
  },
  get round() {
    return round;
  },
  skipIntro() {
    rig.skipPath();
  },
  composeInfo() {
    if (!compose) return null;
    return compose.st.dots.map((d, i) => {
      const f = rig.focusOf(d.pos, {});
      return { line: compose.lines[i], angle: +f.angle.toFixed(4), x: Math.round(f.x), y: Math.round(f.y), behind: f.behind, dotPos: d.pos.toArray().map((v) => +v.toFixed(1)) };
    });
  },
  camInfo() {
    return {
      pos: camera.position.toArray().map((v) => +v.toFixed(1)),
      rot: [+camera.rotation.x.toFixed(3), +camera.rotation.y.toFixed(3)],
      fov: camera.fov,
      aspect: +camera.aspect.toFixed(3),
      projM: [+camera.projectionMatrix.elements[0].toFixed(3), +camera.projectionMatrix.elements[5].toFixed(3)],
      win: [window.innerWidth, window.innerHeight],
      mwiStale: (() => {
        const m = camera.matrixWorld.clone().invert();
        const d = m.elements.map((v, i) => Math.abs(v - camera.matrixWorldInverse.elements[i])).reduce((a, b) => a + b, 0);
        return +d.toFixed(4);
      })(),
    };
  },
  select(i = null) {
    debugSelect = i ?? 0;
  },
  pressSelect() {
    input._select = true;
  },
  goto(biomeName, themeName) {
    const q = new URLSearchParams(location.search);
    if (biomeName) q.set('biome', biomeName);
    if (themeName) q.set('theme', themeName);
    location.search = q.toString();
  },
  fps(frames = 60) {
    return new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const step = () => (++n >= frames ? resolve((n * 1000) / (performance.now() - t0)) : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  },
});
