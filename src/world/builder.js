// Shared world kit. A biome module receives a `kit` (factories for terrain,
// water, sky, vegetation, particles, props, critters) and assembles its own
// vista, returning camera stations. Everything is procedural — no asset files.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lookPose } from '../cameraRig.js';

// ---------------------------------------------------------------- utilities

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (
    hash2(xi, yi) * (1 - u) * (1 - v) +
    hash2(xi + 1, yi) * u * (1 - v) +
    hash2(xi, yi + 1) * (1 - u) * v +
    hash2(xi + 1, yi + 1) * u * v
  );
}

export function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// ---------------------------------------------------------------- shaders

const WATER_VERT = /* glsl */ `
  uniform float uTime, uSwellAmp, uSwellFreq;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    float w1 = sin((p.x + uTime * 9.0) * uSwellFreq);
    float w2 = sin((p.z * 1.31 - uTime * 6.2) * uSwellFreq * 1.7 + 1.3);
    p.y += (w1 + w2) * uSwellAmp;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform vec3 uDeep, uShallow, uSunDir, uSunColor, uFogColor;
  uniform float uTime, uFogNear, uFogFar, uSparkle;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float n1 = noise(vWorld.xz * 0.33 + vec2(uTime * 0.50, uTime * 0.31));
    float n2 = noise(vWorld.xz * 0.91 - vec2(uTime * 0.42, uTime * 0.60));
    vec3 N = normalize(vec3((n1 - 0.5) * 0.42, 1.0, (n2 - 0.5) * 0.42));
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    vec3 col = mix(uDeep, uShallow, clamp(fres * 0.85 + 0.08, 0.0, 1.0));
    vec3 R = reflect(-normalize(uSunDir), N);
    float spec = pow(max(dot(R, V), 0.0), 90.0);
    col += uSunColor * spec * 0.85;
    float glint = step(0.986 - uSparkle * 0.012,
                       noise(vWorld.xz * 4.2 + vec2(uTime * 1.8, -uTime * 1.4)));
    col += uSunColor * glint * 0.30;
    float fogF = smoothstep(uFogNear, uFogFar, distance(cameraPosition, vWorld));
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, 0.93);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
  uniform float uSunSize;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h >= 0.0
      ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.7));
    float cosA = dot(d, normalize(uSunDir));
    float disk = smoothstep(cos(uSunSize), cos(uSunSize * 0.55), cosA);
    float glow = pow(max(cosA, 0.0), 22.0) * 0.55 + pow(max(cosA, 0.0), 5.0) * 0.22;
    col += uSunColor * (disk * 1.15 + glow);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime, uSize, uFall, uRise, uSwirl;
  uniform vec3 uCenter, uBox;
  uniform vec2 uWind;
  attribute vec4 aSeed;
  varying float vRot, vTint, vPulse;
  void main() {
    vec3 p = position;
    float t = uTime * (0.7 + aSeed.x * 0.6);
    p.x += uWind.x * uTime * (0.6 + aSeed.y * 0.8) + sin(t * 0.9 + aSeed.z * 6.28) * uSwirl;
    p.z += uWind.y * uTime * (0.6 + aSeed.w * 0.8) + cos(t * 0.7 + aSeed.y * 6.28) * uSwirl;
    p.y += (uRise - uFall) * uTime * (0.7 + aSeed.z * 0.6);
    p.y += sin(t * 1.3 + aSeed.x * 6.28) * uSwirl * 0.35;
    vec3 lo = uCenter - uBox * 0.5;
    p = mod(p - lo, uBox) + lo;
    vRot = t * 2.2 + aSeed.w * 6.28;
    vTint = aSeed.x;
    vPulse = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.y * 2.0) + aSeed.z * 6.28);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (170.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }
`;

const PETAL_FRAG = /* glsl */ `
  uniform vec3 uColorA, uColorB;
  varying float vRot, vTint, vPulse;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    pc = mat2(c, -s, s, c) * pc;
    vec2 e = pc * vec2(2.1, 3.1);
    float d = dot(e, e);
    float a = smoothstep(1.0, 0.72, d);
    a *= smoothstep(0.10, 0.20, length(pc - vec2(0.0, 0.33)));
    if (a < 0.03) discard;
    gl_FragColor = vec4(mix(uColorA, uColorB, vTint), a * 0.9);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColorA, uColorB;
  uniform float uAlpha;
  varying float vRot, vTint, vPulse;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.4) * vPulse * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColorA, uColorB, vTint), a);
  }
`;

// ---------------------------------------------------------------- the kit

class Kit {
  constructor(world, seed) {
    this.world = world;
    this.scene = world.scene;
    this.rng = mulberry32(seed);
    this.time = world.timeUniform;
    this.noise2 = noise2;
    this.fbm = fbm;
    this.heightAt = () => 0;
    this.sunDir = new THREE.Vector3(-0.5, 0.35, -0.4).normalize();
    this.sunColor = new THREE.Color('#ffd9a0');
    this.fogColor = new THREE.Color('#e8c8a0');
    this.fogNear = 120;
    this.fogFar = 520;
  }

  track(obj) {
    this.world.disposables.add(obj);
    return obj;
  }

  add(obj) {
    this.scene.add(obj);
    obj.traverse?.((o) => {
      if (o.geometry) this.track(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => this.track(m));
    });
    return obj;
  }

  onUpdate(fn) {
    this.world.updatables.push(fn);
  }

  // ----- atmosphere -----

  fog(color, near, far) {
    this.fogColor = new THREE.Color(color);
    this.fogNear = near;
    this.fogFar = far;
    this.scene.fog = new THREE.Fog(this.fogColor, near, far);
  }

  lights({ hemiSky = '#ffe7c4', hemiGround = '#5a6b4a', hemiI = 0.85, sunColor = '#ffd9a0', sunI = 1.9, sunDir = null } = {}) {
    if (sunDir) this.sunDir.copy(sunDir).normalize();
    this.sunColor = new THREE.Color(sunColor);
    const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiI);
    const sun = new THREE.DirectionalLight(sunColor, sunI);
    sun.position.copy(this.sunDir).multiplyScalar(400);
    this.add(hemi);
    this.add(sun);
  }

  sky({ top = '#5e7ea8', horizon = '#f4c98e', bottom = '#8a7a66', sunSize = 0.045 } = {}) {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color(top) },
        uHorizon: { value: new THREE.Color(horizon) },
        uBottom: { value: new THREE.Color(bottom) },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color(this.sunColor) },
        uSunSize: { value: sunSize },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    return this.add(mesh);
  }

  clouds({ count = 9, color = '#fff0dc', opacity = 0.55, height = [90, 160], radius = [380, 650], speed = 1.6 } = {}) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const items = [];
    for (let i = 0; i < count; i++) {
      const puff = new THREE.Group();
      const n = 2 + Math.floor(this.rng() * 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set((this.rng() - 0.5) * 38, (this.rng() - 0.5) * 6, (this.rng() - 0.5) * 16);
        m.scale.set(14 + this.rng() * 22, 4 + this.rng() * 5, 9 + this.rng() * 9);
        puff.add(m);
      }
      const ang = this.rng() * Math.PI * 2;
      const r = radius[0] + this.rng() * (radius[1] - radius[0]);
      puff.position.set(Math.cos(ang) * r, height[0] + this.rng() * (height[1] - height[0]), Math.sin(ang) * r);
      group.add(puff);
      items.push({ puff, speed: speed * (0.5 + this.rng()) });
    }
    this.add(group);
    this.onUpdate((dt) => {
      for (const it of items) {
        it.puff.position.x += it.speed * dt;
        if (it.puff.position.x > 720) it.puff.position.x = -720;
      }
    });
    return group;
  }

  ridges(layers) {
    // jagged silhouette mountain rings, flat-shaded against the haze
    const group = new THREE.Group();
    for (const { radius, height, color, seed = 0, y = -10 } of layers) {
      const N = 160;
      const pos = [];
      const idx = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const jag = fbm(Math.cos(a) * 2.3 + seed * 11.7, Math.sin(a) * 2.3 + seed * 7.3, 4);
        const peak = fbm(Math.cos(a) * 6.1 + seed * 3.1, Math.sin(a) * 6.1 + seed * 5.9, 3);
        const h = height * (0.35 + 0.65 * jag) * (0.7 + 0.6 * peak);
        const r = radius * (0.94 + 0.12 * fbm(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 - seed, 3));
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        pos.push(Math.cos(a) * r, y + h, Math.sin(a) * r);
      }
      for (let i = 0; i < N; i++) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = -50;
      group.add(mesh);
    }
    return this.add(group);
  }

  // ----- ground + water -----

  terrain({ size = 620, segments = 150, height, color }) {
    this.heightAt = height;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const h = height(x, z);
      p.setY(i, h);
    }
    geo.computeVertexNormals();
    const n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const h = p.getY(i);
      const slope = 1 - n.getY(i);
      color(c, x, z, h, slope, this.rng);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    return this.add(mesh);
  }

  water({ level = 0, size = 700, deep = '#1d4e5e', shallow = '#7fc4c9', swellAmp = 0.05, swellFreq = 0.5, sparkle = 1 } = {}) {
    const geo = new THREE.PlaneGeometry(size, size, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      uniforms: {
        uTime: this.time,
        uSwellAmp: { value: swellAmp },
        uSwellFreq: { value: swellFreq },
        uDeep: { value: new THREE.Color(deep) },
        uShallow: { value: new THREE.Color(shallow) },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color(this.sunColor) },
        uFogColor: { value: this.fogColor },
        uFogNear: { value: this.fogNear },
        uFogFar: { value: this.fogFar },
        uSparkle: { value: sparkle },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = level;
    return this.add(mesh);
  }

  // ----- vegetation -----

  _swayify(mat, { amp = 0.12, speed = 1.3, maxY = 4 } = {}) {
    const time = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #else
              vec3 ip = vec3(0.0);
            #endif
            float ph = ip.x * 0.37 + ip.z * 0.53;
            float k = pow(smoothstep(0.0, ${maxY.toFixed(2)}, transformed.y), 1.4);
            float s1 = sin(uTime * ${speed.toFixed(2)} + ph);
            float s2 = sin(uTime * ${(speed * 1.73).toFixed(2)} + ph * 1.31 + 1.7);
            transformed.x += (s1 * 0.8 + s2 * 0.2) * ${amp.toFixed(3)} * k;
            transformed.z += (s2 * 0.7 + s1 * 0.3) * ${(amp * 0.7).toFixed(3)} * k;
          }`
        );
    };
    mat.customProgramCacheKey = () => `sway-${amp}-${speed}-${maxY}`;
    return mat;
  }

  _coloredGeo(geo, colorFn) {
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      colorFn(c, p.getX(i), p.getY(i), p.getZ(i));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  treeGeo(kind = 'maple', { canopy = '#c2491f', canopyB = '#e8852f', trunk = '#5c4632' } = {}) {
    const rng = this.rng;
    const parts = [];
    const trunkC = new THREE.Color(trunk);
    const cA = new THREE.Color(canopy);
    const cB = new THREE.Color(canopyB);

    if (kind === 'pine') {
      const tg = new THREE.CylinderGeometry(0.09, 0.2, 3.2, 5);
      tg.translate(0, 1.6, 0);
      parts.push(this._coloredGeo(tg, (c) => c.copy(trunkC)));
      const tiers = [
        [1.5, 1.7, 1.6],
        [1.15, 1.45, 2.55],
        [0.72, 1.2, 3.5],
      ];
      let lean = 0;
      for (const [r, h, y] of tiers) {
        const g = new THREE.ConeGeometry(r, h, 7);
        lean += 0.22;
        g.translate(lean * 0.6, y, 0);
        parts.push(
          this._coloredGeo(g, (c, x, yy) => {
            c.copy(cA).lerp(cB, THREE.MathUtils.clamp((yy - 1) / 3.5, 0, 1) * 0.6 + rng() * 0.12);
          })
        );
      }
    } else {
      // maple / sakura: trunk + blobs
      const tg = new THREE.CylinderGeometry(0.13, 0.26, 2.4, 6);
      tg.translate(0, 1.2, 0);
      parts.push(this._coloredGeo(tg, (c) => c.copy(trunkC)));
      const blobs = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < blobs; i++) {
        const r = 1.15 + rng() * 0.85;
        const g = new THREE.IcosahedronGeometry(r, 1);
        const ang = rng() * Math.PI * 2;
        const d = rng() * 1.1;
        const y = 2.5 + rng() * 1.1;
        g.translate(Math.cos(ang) * d, y, Math.sin(ang) * d);
        // jitter vertices for a leafy clumped look
        const p = g.attributes.position;
        for (let v = 0; v < p.count; v++) {
          p.setXYZ(
            v,
            p.getX(v) + (rng() - 0.5) * 0.22,
            p.getY(v) + (rng() - 0.5) * 0.22,
            p.getZ(v) + (rng() - 0.5) * 0.22
          );
        }
        parts.push(
          this._coloredGeo(g, (c, x, yy) => {
            c.copy(cA).lerp(cB, THREE.MathUtils.clamp((yy - 2) / 2.6, 0, 1) * 0.85 + (rng() - 0.5) * 0.15);
          })
        );
      }
    }
    const merged = mergeGeometries(
      parts.map((g) => g.toNonIndexed()),
      false
    );
    parts.forEach((g) => g.dispose());
    return merged;
  }

  grassGeo({ a = '#7a8c3f', b = '#c9b458' } = {}) {
    const cA = new THREE.Color(a);
    const cB = new THREE.Color(b);
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(0.07, 0.55, 1, 2);
      g.translate(0, 0.27, 0);
      g.rotateY((i / 3) * Math.PI);
      parts.push(g);
    }
    const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    parts.forEach((g) => g.dispose());
    return this._coloredGeo(merged, (c, x, y) => c.copy(cA).lerp(cB, THREE.MathUtils.clamp(y / 0.55, 0, 1)));
  }

  flowerGeo({ petal = '#e8e4f0', center = '#e8b34b', stem = '#5f7a37' } = {}) {
    const parts = [];
    const sg = new THREE.CylinderGeometry(0.012, 0.018, 0.34, 4);
    sg.translate(0, 0.17, 0);
    parts.push(this._coloredGeo(sg, (c) => c.set(stem)));
    const hg = new THREE.IcosahedronGeometry(0.075, 0);
    hg.scale(1, 0.55, 1);
    hg.translate(0, 0.36, 0);
    parts.push(this._coloredGeo(hg, (c) => c.set(petal)));
    const cg = new THREE.IcosahedronGeometry(0.028, 0);
    cg.translate(0, 0.40, 0);
    parts.push(this._coloredGeo(cg, (c) => c.set(center)));
    const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    parts.forEach((g) => g.dispose());
    return merged;
  }

  pampasGeo({ stalk = '#9a8d52', plume = '#efe3c8' } = {}) {
    const parts = [];
    const sg = new THREE.CylinderGeometry(0.015, 0.03, 1.25, 4);
    sg.translate(0, 0.62, 0);
    parts.push(this._coloredGeo(sg, (c) => c.set(stalk)));
    const pg = new THREE.IcosahedronGeometry(0.16, 1);
    pg.scale(1, 2.6, 1);
    pg.translate(0, 1.55, 0);
    const rng = this.rng;
    parts.push(this._coloredGeo(pg, (c) => c.set(plume).offsetHSL(0, 0, (rng() - 0.5) * 0.08)));
    const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    parts.forEach((g) => g.dispose());
    return merged;
  }

  rockGeo({ color = '#8d867c' } = {}) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const rng = this.rng;
    for (let i = 0; i < p.count; i++) {
      const sc = 0.75 + rng() * 0.5;
      p.setXYZ(i, p.getX(i) * sc, p.getY(i) * sc * 0.7, p.getZ(i) * sc);
    }
    g.computeVertexNormals();
    const base = new THREE.Color(color);
    return this._coloredGeo(g, (c, x, y) => c.copy(base).offsetHSL(0, 0, y * 0.06 + (rng() - 0.5) * 0.04));
  }

  // Scatter a geometry as an InstancedMesh. place(i, rng) -> {x, z, y?, s?, rot?, tint?} | null
  scatter(geo, { count, place, sway = null, tintRange = 0.12 } = {}) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (sway) this._swayify(mat, sway);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    let placed = 0;
    let guard = count * 30;
    while (placed < count && guard-- > 0) {
      const spot = place(placed, this.rng);
      if (!spot) continue;
      const y = spot.y ?? this.heightAt(spot.x, spot.z);
      const s = spot.s ?? 1;
      q.setFromAxisAngle(up, spot.rot ?? this.rng() * Math.PI * 2);
      m.compose(new THREE.Vector3(spot.x, y, spot.z), q, new THREE.Vector3(s, s * (0.92 + this.rng() * 0.16), s));
      mesh.setMatrixAt(placed, m);
      c.setHSL(0, 0, 1).offsetHSL((this.rng() - 0.5) * 0.02, (this.rng() - 0.5) * 0.1, (this.rng() - 0.5) * tintRange);
      if (spot.tint) c.multiply(spot.tint);
      mesh.setColorAt(placed, c);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return this.add(mesh);
  }

  // ----- particles -----

  _particles({ count, box, center = [0, 0, 0], size, frag, uniforms, blending = THREE.NormalBlending }) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = center[0] + (this.rng() - 0.5) * box[0];
      pos[i * 3 + 1] = center[1] + (this.rng() - 0.5) * box[1];
      pos[i * 3 + 2] = center[2] + (this.rng() - 0.5) * box[2];
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = this.rng();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: {
        uTime: this.time,
        uSize: { value: size * Math.min(window.devicePixelRatio || 1, 1.6) },
        uFall: { value: 0 },
        uRise: { value: 0 },
        uSwirl: { value: 1.2 },
        uWind: { value: new THREE.Vector2(1.4, 0.5) },
        uCenter: { value: new THREE.Vector3(...center) },
        uBox: { value: new THREE.Vector3(...box) },
        uColorA: { value: new THREE.Color('#ffffff') },
        uColorB: { value: new THREE.Color('#ffffff') },
        uAlpha: { value: 1 },
        ...uniforms,
      },
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return this.add(points);
  }

  petals({ count = 900, box = [320, 70, 320], center = [0, 28, 0], colorA = '#e86a4a', colorB = '#f4b46a', size = 5.5, fall = 0.55, wind = [2.2, 0.8], swirl = 1.6 } = {}) {
    const p = this._particles({ count, box, center, size, frag: PETAL_FRAG, uniforms: {} });
    p.material.uniforms.uColorA.value.set(colorA);
    p.material.uniforms.uColorB.value.set(colorB);
    p.material.uniforms.uFall.value = fall;
    p.material.uniforms.uWind.value.set(wind[0], wind[1]);
    p.material.uniforms.uSwirl.value = swirl;
    return p;
  }

  fireflies({ count = 130, box = [220, 26, 220], center = [0, 8, 0], colorA = '#ffe9a8', colorB = '#c8e87a', size = 7, alpha = 0.85 } = {}) {
    const p = this._particles({
      count,
      box,
      center,
      size,
      frag: GLOW_FRAG,
      uniforms: {},
      blending: THREE.AdditiveBlending,
    });
    p.material.uniforms.uColorA.value.set(colorA);
    p.material.uniforms.uColorB.value.set(colorB);
    p.material.uniforms.uSwirl.value = 2.4;
    p.material.uniforms.uWind.value.set(0.25, 0.1);
    p.material.uniforms.uAlpha.value = alpha;
    return p;
  }

  spray({ count = 240, box = [180, 16, 60], center = [0, 4, 0], color = '#f4ffff', size = 9, rise = 1.4 } = {}) {
    const p = this._particles({
      count,
      box,
      center,
      size,
      frag: GLOW_FRAG,
      uniforms: {},
      blending: THREE.AdditiveBlending,
    });
    p.material.uniforms.uColorA.value.set(color);
    p.material.uniforms.uColorB.value.set(color);
    p.material.uniforms.uRise.value = rise;
    p.material.uniforms.uSwirl.value = 0.9;
    p.material.uniforms.uAlpha.value = 0.28;
    return p;
  }

  // ----- props + critters -----

  torii(pos, rotY = 0, scale = 1, color = '#c43d2e') {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: '#2e2620' });
    const pillar = new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8);
    for (const sx of [-1.5, 1.5]) {
      const p = new THREE.Mesh(pillar, mat);
      p.position.set(sx, 1.7, 0);
      g.add(p);
    }
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 0.4), dark);
    kasagi.position.y = 3.45;
    const shimaki = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.34), mat);
    shimaki.position.y = 3.2;
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.2, 0.26), mat);
    nuki.position.y = 2.45;
    g.add(kasagi, shimaki, nuki);
    g.position.copy(pos);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    return this.add(g);
  }

  lantern(pos, scale = 1) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: '#9a958c' });
    const stack = [
      [new THREE.CylinderGeometry(0.34, 0.42, 0.18, 6), 0.09],
      [new THREE.CylinderGeometry(0.12, 0.16, 0.55, 6), 0.45],
      [new THREE.CylinderGeometry(0.3, 0.24, 0.3, 6), 0.88],
      [new THREE.ConeGeometry(0.42, 0.3, 6), 1.18],
      [new THREE.SphereGeometry(0.08, 6, 5), 1.4],
    ];
    for (const [geo, y] of stack) {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      g.add(m);
    }
    g.position.copy(pos);
    g.scale.setScalar(scale);
    return this.add(g);
  }

  dragonfly(anchor, { scale = 1 } = {}) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: '#3a6e8c' });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.009, 0.085, 5), bodyMat);
    body.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), bodyMat);
    head.position.z = 0.05;
    g.add(body, head);
    const wingMat = new THREE.MeshBasicMaterial({
      color: '#dff4ff',
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wingGeo = new THREE.PlaneGeometry(0.085, 0.02);
    const wings = [];
    for (const [sx, sz] of [[-1, 0.012], [1, 0.012], [-1, -0.012], [1, -0.012]]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(sx * 0.045, 0.004, sz);
      w.rotation.x = -Math.PI / 2;
      wings.push([w, sx]);
      g.add(w);
    }
    g.position.copy(anchor);
    g.scale.setScalar(scale);
    this.add(g);
    const a = anchor.clone();
    let t = this.rng() * 10;
    const target = a.clone();
    let next = 0;
    this.onUpdate((dt, time) => {
      t += dt;
      for (const [w, sx] of wings) w.rotation.y = sx * (0.5 + Math.sin(t * 52) * 0.55);
      if (t > next) {
        next = t + 1.6 + this.rng() * 2.4;
        target.set(a.x + (this.rng() - 0.5) * 0.5, a.y + (this.rng() - 0.5) * 0.22, a.z + (this.rng() - 0.5) * 0.5);
      }
      g.position.lerp(target, 1 - Math.exp(-dt * 2.2));
      g.position.y += Math.sin(t * 7) * 0.0015;
      g.lookAt(target.x, g.position.y, target.z);
    });
    return g;
  }

  butterfly(anchor, { color = '#e8943a', scale = 1 } = {}) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.034, 0.046);
    const L = new THREE.Mesh(wingGeo, mat);
    const R = new THREE.Mesh(wingGeo, mat);
    L.position.x = -0.018;
    R.position.x = 0.018;
    g.add(L, R);
    g.position.copy(anchor);
    g.scale.setScalar(scale);
    this.add(g);
    let t = this.rng() * 10;
    const a = anchor.clone();
    this.onUpdate((dt) => {
      t += dt;
      const flap = Math.sin(t * 16) * 0.9;
      L.rotation.y = -0.5 - flap;
      R.rotation.y = 0.5 + flap;
      g.position.set(
        a.x + Math.sin(t * 0.55) * 0.45,
        a.y + Math.sin(t * 1.3) * 0.12 + Math.abs(Math.sin(t * 16)) * 0.004,
        a.z + Math.cos(t * 0.4) * 0.45
      );
      g.rotation.y = t * 0.4;
    });
    return g;
  }

  // A blossoming branch for macro scenes.
  blossomBranch(pos, { dir = new THREE.Vector3(1, 0.15, 0.2), length = 1.4, blossom = '#f7c6d9', blossomB = '#f2a3c0', bark = '#54402e' } = {}) {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshLambertMaterial({ color: bark });
    const d = dir.clone().normalize();
    const segs = 4;
    let p = new THREE.Vector3();
    const tips = [];
    for (let i = 0; i < segs; i++) {
      const len = (length / segs) * (1 - i * 0.12);
      const r0 = 0.028 * (1 - i * 0.18);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.75, r0, len, 5), barkMat);
      const dd = d
        .clone()
        .add(new THREE.Vector3((this.rng() - 0.5) * 0.4, (this.rng() - 0.3) * 0.4, (this.rng() - 0.5) * 0.4))
        .normalize();
      seg.position.copy(p).addScaledVector(dd, len / 2);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dd);
      g.add(seg);
      p = p.clone().addScaledVector(dd, len);
      tips.push(p.clone());
    }
    const cA = new THREE.Color(blossom);
    const cB = new THREE.Color(blossomB);
    const petalGeo = new THREE.CircleGeometry(0.028, 5);
    const blossoms = new THREE.Group();
    for (const tip of tips) {
      const n = 3 + Math.floor(this.rng() * 4);
      for (let i = 0; i < n; i++) {
        const cl = new THREE.Group();
        const center = tip
          .clone()
          .add(new THREE.Vector3((this.rng() - 0.5) * 0.3, (this.rng() - 0.5) * 0.2, (this.rng() - 0.5) * 0.3));
        const col = cA.clone().lerp(cB, this.rng());
        const mat = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
        for (let k = 0; k < 5; k++) {
          const petal = new THREE.Mesh(petalGeo, mat);
          const ang = (k / 5) * Math.PI * 2;
          petal.position.set(Math.cos(ang) * 0.022, 0, Math.sin(ang) * 0.022);
          petal.rotation.set(-Math.PI / 2 + 0.5, 0, -ang);
          cl.add(petal);
        }
        cl.position.copy(center);
        cl.rotation.set(this.rng() * 0.8, this.rng() * Math.PI * 2, this.rng() * 0.8);
        blossoms.add(cl);
      }
    }
    g.add(blossoms);
    g.position.copy(pos);
    return this.add(g);
  }

  // A patch of "hero" wildflowers detailed enough for the macro stage.
  wildflowerPatch(pos, { petal = '#e6e9f5', center = '#e8b34b', count = 7, radius = 0.45 } = {}) {
    const g = new THREE.Group();
    const stemMat = new THREE.MeshLambertMaterial({ color: '#55703a' });
    const petalGeo = new THREE.CircleGeometry(0.05, 6);
    for (let i = 0; i < count; i++) {
      const f = new THREE.Group();
      const h = 0.26 + this.rng() * 0.3;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, h, 4), stemMat);
      stem.position.y = h / 2;
      f.add(stem);
      const col = new THREE.Color(petal).offsetHSL((this.rng() - 0.5) * 0.05, 0, (this.rng() - 0.5) * 0.1);
      const mat = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
      const head = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const p = new THREE.Mesh(petalGeo, mat);
        const ang = (k / 6) * Math.PI * 2;
        p.position.set(Math.cos(ang) * 0.045, 0, Math.sin(ang) * 0.045);
        p.rotation.set(-Math.PI / 2 + 0.45, 0, -ang);
        head.add(p);
      }
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 6, 5),
        new THREE.MeshLambertMaterial({ color: center })
      );
      head.add(c);
      head.position.y = h;
      head.rotation.set((this.rng() - 0.5) * 0.5, this.rng() * Math.PI, 0);
      f.add(head);
      const ang = this.rng() * Math.PI * 2;
      const r = this.rng() * radius;
      f.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      g.add(f);
    }
    g.position.copy(pos);
    return this.add(g);
  }

  // ----- camera station helpers -----

  poseLook(pos, target, fov = 55) {
    const { yaw, pitch } = lookPose(pos, target);
    return { pos: pos.clone(), yaw, pitch, fov };
  }

  // Builds a compose station whose look-cone is guaranteed to contain the dots.
  station(pos, dots, { fov = 45, coneYaw = 0.5, conePitch = 0.3, dotScale = 1 } = {}) {
    const dirs = dots.map((d) => lookPose(pos, d.pos));
    let baseYaw = dirs[0].yaw;
    // average yaw, unwrapped near the first dot's bearing
    let sumYaw = 0;
    for (const d of dirs) {
      let y = d.yaw;
      while (y - baseYaw > Math.PI) y -= Math.PI * 2;
      while (y - baseYaw < -Math.PI) y += Math.PI * 2;
      sumYaw += y;
    }
    const yaw = sumYaw / dirs.length;
    const pitch = dirs.reduce((s, d) => s + d.pitch, 0) / dirs.length;
    let needYaw = coneYaw;
    let needPitch = conePitch;
    for (const d of dirs) {
      let dy = d.yaw - yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      needYaw = Math.max(needYaw, Math.abs(dy) + 0.14);
      needPitch = Math.max(needPitch, Math.abs(d.pitch - pitch) + 0.09);
    }
    return { pos: pos.clone(), yaw, pitch, fov, coneYaw: needYaw, conePitch: needPitch, dots, dotScale };
  }
}

// ---------------------------------------------------------------- markers

class DotMarker {
  constructor(scene, tex) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: '#fff3da',
      })
    );
    this.sprite.renderOrder = 50;
    this.sprite.visible = false;
    this.focus = 0;
    this.baseScale = 1;
    scene.add(this.sprite);
  }

  show(pos, scale) {
    this.sprite.position.copy(pos);
    this.baseScale = scale;
    this.sprite.visible = true;
  }

  hide() {
    this.sprite.visible = false;
  }

  update(t) {
    if (!this.sprite.visible) return;
    const pulse = 1 + Math.sin(t * 2.4) * 0.1;
    const s = this.baseScale * pulse * (1 + this.focus * 0.55);
    this.sprite.scale.set(s, s, 1);
    this.sprite.material.opacity = 0.34 + this.focus * 0.6;
  }
}

// ---------------------------------------------------------------- world

export class World {
  constructor(scene, biomeDef, { seed = 1 } = {}) {
    this.scene = scene;
    this.biome = biomeDef;
    this.timeUniform = { value: 0 };
    this.updatables = [];
    this.disposables = new Set();
    this.kit = new Kit(this, seed);
    this.stations = biomeDef.build(this.kit);
    this.markers = [new DotMarker(scene, glowTexture()), new DotMarker(scene, glowTexture()), new DotMarker(scene, glowTexture())];
  }

  showDots(stageIdx) {
    const st = this.stations.stages[stageIdx];
    st.dots.forEach((d, i) => this.markers[i].show(d.pos, st.dotScale));
  }

  hideDots() {
    for (const m of this.markers) m.hide();
  }

  setDotFocus(i, f) {
    this.markers[i].focus = f;
  }

  update(dt) {
    this.timeUniform.value += dt;
    const t = this.timeUniform.value;
    for (const fn of this.updatables) fn(dt, t);
    for (const m of this.markers) m.update(t);
  }

  dispose() {
    for (const m of this.markers) {
      this.scene.remove(m.sprite);
      m.sprite.material.dispose();
    }
    for (const d of this.disposables) d.dispose?.();
    this.disposables.clear();
    // remove everything but keep the scene object itself
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
    this.scene.fog = null;
  }
}
