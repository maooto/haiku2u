// Cherry-blossom valley in late afternoon: a slow stream, pink groves
// breathing petals into the air, a stone lantern by the meditation knoll.

import * as THREE from 'three';

const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

export default {
  name: 'sakura',
  ambience: 'sakura',

  build(kit) {
    const { fbm } = kit;

    const streamX = (z) => 10 * Math.sin(z * 0.015) + 8 * Math.sin(z * 0.007 + 0.8);
    const height = (x, z) => {
      const d = Math.abs(x - streamX(z));
      let h = 0;
      if (d < 6) h = -1.5 * (1 - (d / 6) ** 2);
      h += smooth(6, 30, d) * 3.2;
      h += fbm(x * 0.013 + 5.3, z * 0.013 + 8.8, 4) ** 1.2 * 16 * smooth(8, 50, d);
      h += smooth(150, 310, d) * 46;
      h += 8 * gauss(x, z, 56, 40, 32); // the meditation knoll
      return h;
    };

    kit.fog('#f0d3b8', 80, 430);
    kit.lights({
      hemiSky: '#ffe6cf',
      hemiGround: '#7a7258',
      hemiI: 1.0,
      sunColor: '#ffd2a8',
      sunI: 1.85,
      sunDir: new THREE.Vector3(-0.45, 0.3, -0.84),
    });
    kit.sky({ top: '#6f8fb8', horizon: '#f6cfae', bottom: '#8a7868', sunSize: 0.045 });
    kit.ridges([
      { radius: 300, height: 80, color: '#c39a90', seed: 9 },
      { radius: 390, height: 130, color: '#d3b2a4', seed: 10 },
      { radius: 470, height: 165, color: '#e2c8b6', seed: 11 },
    ]);
    kit.clouds({ color: '#fff0e2', opacity: 0.5 });

    const moss1 = new THREE.Color('#7d9148');
    const moss2 = new THREE.Color('#b3a657');
    const rock = new THREE.Color('#84796c');
    const pebble = new THREE.Color('#8f8068');
    kit.terrain({
      height,
      color: (c, x, z, h, slope, rng) => {
        if (h < 0.35) c.copy(pebble).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
        else {
          c.copy(moss1).lerp(moss2, fbm(x * 0.045, z * 0.045, 3) * 0.8);
          // fallen petals dust the grass near the groves
          const petalDust =
            gauss(x, z, -45, -25, 38) + gauss(x, z, 30, -62, 30) + gauss(x, z, -22, 82, 34);
          c.lerp(new THREE.Color('#d8a8b8'), Math.min(petalDust * 0.55, 0.5));
          if (slope > 0.3) c.lerp(rock, Math.min((slope - 0.3) * 2.5, 1));
        }
      },
    });

    kit.water({ level: 0, deep: '#2a5450', shallow: '#a3d4c4', swellAmp: 0.022, swellFreq: 1.15, sparkle: 0.9 });

    // ----- vegetation -----
    const heroTree = { x: -18, z: 62 };
    const seat = { x: 50, z: 42 };
    const clear = (x, z) =>
      (x - heroTree.x) ** 2 + (z - heroTree.z) ** 2 > 14 * 14 && (x - seat.x) ** 2 + (z - seat.z) ** 2 > 9 * 9;

    const sakuraA = kit.treeGeo('maple', { canopy: '#f2b8cd', canopyB: '#f8d8e6', trunk: '#4f3d33' });
    const sakuraB = kit.treeGeo('maple', { canopy: '#e89ab8', canopyB: '#f4c3d8', trunk: '#564238' });

    const grovePlace = (g1, g2) => (i, rng) => {
      const x = (rng() * 2 - 1) * 240;
      const z = (rng() * 2 - 1) * 240;
      const d = Math.abs(x - streamX(z));
      if (d < 9 || !clear(x, z)) return null;
      const w = 0.14 + gauss(x, z, g1.x, g1.z, 36) * 1.2 + gauss(x, z, g2.x, g2.z, 30) * 0.9;
      if (rng() > w || height(x, z) > 30) return null;
      return { x, z, s: 0.85 + rng() * 0.75 };
    };
    kit.scatter(sakuraA, { count: 120, place: grovePlace({ x: -45, z: -25 }, { x: -22, z: 82 }), sway: { amp: 0.05, speed: 1.1, maxY: 4 } });
    kit.scatter(sakuraB, { count: 100, place: grovePlace({ x: 30, z: -62 }, { x: -70, z: 30 }), sway: { amp: 0.05, speed: 1.0, maxY: 4 } });

    // the lone sakura on the stream bank (stage 2 subject)
    const heroY = kit.heightAt(heroTree.x, heroTree.z);
    kit.scatter(sakuraA, {
      count: 1,
      place: () => ({ x: heroTree.x, z: heroTree.z, s: 2.4, rot: 1.9 }),
      sway: { amp: 0.06, speed: 1.0, maxY: 4 },
    });

    const grass = kit.grassGeo({ a: '#7f9447', b: '#c6b35e' });
    kit.scatter(grass, {
      count: 2100,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 130;
        const z = (rng() * 2 - 1) * 150;
        const d = Math.abs(x - streamX(z));
        if (d < 7 || d > 100) return null;
        return { x, z, s: 0.8 + rng() * 1.0 };
      },
      sway: { amp: 0.09, speed: 1.6, maxY: 0.55 },
    });

    const flower = kit.flowerGeo({ petal: '#f6dce8', center: '#d9a23a' });
    kit.scatter(flower, {
      count: 320,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 110;
        const z = (rng() * 2 - 1) * 120;
        const d = Math.abs(x - streamX(z));
        const w = 0.3 + gauss(x, z, 48, 36, 20) * 1.2;
        if (d < 8 || rng() > w) return null;
        return { x, z, s: 0.9 + rng() * 0.8 };
      },
      sway: { amp: 0.05, speed: 1.8, maxY: 0.4 },
    });

    const rockGeo = kit.rockGeo({ color: '#8a8174' });
    kit.scatter(rockGeo, {
      count: 50,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 140;
        const z = (rng() * 2 - 1) * 140;
        const d = Math.abs(x - streamX(z));
        if (d > 40) return null;
        return { x, z, s: 0.25 + rng() * 0.9 };
      },
    });

    // stone lantern beside the knoll path
    kit.lantern(new THREE.Vector3(45, kit.heightAt(45, 37), 37), 1.1);

    // THE petal storm
    kit.petals({
      count: 1500,
      colorA: '#f7c6d9',
      colorB: '#f2a3c0',
      size: 4.6,
      fall: 0.5,
      wind: [2.6, 0.7],
      swirl: 2.1,
      center: [0, 30, 0],
      box: [340, 80, 340],
    });
    kit.fireflies({ count: 70, center: [0, 6, 40], box: [200, 18, 220], alpha: 0.6 });

    // ----- micro scene: a blossoming branch at eye level by the seat -----
    const microC = { x: 46.2, z: 37.2 };
    const microY = kit.heightAt(microC.x, microC.z);
    const branchBase = new THREE.Vector3(microC.x, microY + 1.32, microC.z);
    kit.blossomBranch(branchBase, {
      dir: new THREE.Vector3(0.9, 0.16, 0.35),
      length: 1.5,
    });
    // dense, slow petal fall right around the branch
    kit.petals({
      count: 90,
      colorA: '#f7c6d9',
      colorB: '#fbe0ec',
      size: 2.6,
      fall: 0.28,
      wind: [0.18, 0.06],
      swirl: 0.18,
      center: [microC.x + 0.7, microY + 1.1, microC.z + 0.3],
      box: [2.4, 1.6, 2.4],
      nearFade: [0.06, 0.22], // these live right in front of the lens
      maxScale: 16,
    });

    // ----- camera stations -----
    const seatY = kit.heightAt(seat.x, seat.z) + 1.15;
    const seatPos = new THREE.Vector3(seat.x, seatY, seat.z);
    const seated = kit.poseLook(seatPos, new THREE.Vector3(-30, 6, 0), 58);

    const stage1 = kit.station(
      seatPos,
      [
        { pos: new THREE.Vector3(-42, kit.heightAt(-45, -22) + 8, -22) }, // the blossom grove
        { pos: new THREE.Vector3(streamX(20), 0.6, 20) }, // light on the stream bend
        { pos: new THREE.Vector3(-15, 11, 30) }, // petals adrift mid-air
      ],
      { fov: 40, dotScale: 2.2 }
    );

    const st2cam = new THREE.Vector3(-5, kit.heightAt(-5, 71) + 1.6, 71);
    const stage2 = kit.station(
      st2cam,
      [
        { pos: new THREE.Vector3(heroTree.x, heroY + 6.6, heroTree.z) }, // crown full of bloom
        { pos: new THREE.Vector3(heroTree.x + 1.4, heroY + 0.9, heroTree.z + 1.4) }, // roots by the water
        { pos: new THREE.Vector3(heroTree.x + 3.0, heroY + 4.2, heroTree.z + 2.4) }, // a laden bough
      ],
      { fov: 44, dotScale: 0.55 }
    );

    const tip = branchBase.clone().add(new THREE.Vector3(1.25, 0.22, 0.48));
    const st3cam = new THREE.Vector3(microC.x - 0.65, microY + 1.28, microC.z - 1.15);
    const stage3 = kit.station(
      st3cam,
      [
        { pos: tip }, // the heavy blossom cluster
        { pos: branchBase.clone().add(new THREE.Vector3(0.62, 0.12, 0.22)) }, // a tight new bud
        { pos: branchBase.clone().add(new THREE.Vector3(0.85, -0.28, 0.55)) }, // petals letting go
      ],
      { fov: 40, dotScale: 0.085 }
    );

    const flyover = [
      new THREE.Vector3(35, 80, 265),
      new THREE.Vector3(-28, 45, 175),
      new THREE.Vector3(-52, 20, 85),
      new THREE.Vector3(-12, 12, 32),
      new THREE.Vector3(24, 14, 24),
      seatPos.clone(),
    ];
    const finale = [
      seatPos.clone(),
      new THREE.Vector3(35, 32, -15),
      new THREE.Vector3(-25, 52, 55),
      new THREE.Vector3(-15, 82, 175),
      new THREE.Vector3(45, 108, 260),
    ];

    return {
      seated,
      stages: [stage1, stage2, stage3],
      flyover,
      finale,
      finaleLook: new THREE.Vector3(-5, 5, 20),
    };
  },
};

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
