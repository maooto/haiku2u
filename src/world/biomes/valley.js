// Mountain valley at golden hour: a winding river, autumn maple groves,
// a torii on the far bank, fireflies rising at dusk.

import * as THREE from 'three';

const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

export default {
  name: 'valley',
  ambience: 'valley',
  petalsMicro: false,

  build(kit) {
    const { fbm } = kit;

    const riverX = (z) => 18 * Math.sin(z * 0.012) + 12 * Math.sin(z * 0.005 + 1.7);
    const height = (x, z) => {
      const d = Math.abs(x - riverX(z));
      let h = 0;
      if (d < 12) h = -2.4 * (1 - (d / 12) ** 2); // river channel
      const bank = smooth(12, 42, d);
      h += bank * 5.5;
      h += fbm(x * 0.011 + 3.7, z * 0.011 - 1.2, 4) ** 1.4 * 30 * smooth(14, 80, d);
      h += smooth(140, 300, d) * 60; // valley walls
      h += 13 * gauss(x, z, 80, 28, 42); // the meditation bluff
      return h;
    };

    kit.fog('#eac698', 90, 480);
    kit.lights({
      hemiSky: '#ffe2b8',
      hemiGround: '#57663f',
      hemiI: 0.95,
      sunColor: '#ffd9a0',
      sunI: 2.0,
      sunDir: new THREE.Vector3(-0.92, 0.21, -0.33),
    });
    kit.sky({ top: '#56729e', horizon: '#f6c184', bottom: '#6e5d4a', sunSize: 0.05 });
    kit.ridges([
      { radius: 290, height: 95, color: '#b08366', seed: 1 },
      { radius: 380, height: 150, color: '#c69d78', seed: 2 },
      { radius: 470, height: 190, color: '#ddbb92', seed: 3 },
    ]);
    kit.clouds({ color: '#ffe9d2', opacity: 0.5 });

    const grass1 = new THREE.Color('#6f8c3a');
    const grass2 = new THREE.Color('#a89a48');
    const rock = new THREE.Color('#7d7468');
    const sand = new THREE.Color('#8a7351');
    kit.terrain({
      height,
      color: (c, x, z, h, slope, rng) => {
        if (h < 0.45) c.copy(sand).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
        else {
          const t = Math.min(Math.max((h - 2) / 30, 0), 1);
          c.copy(grass1).lerp(grass2, t * 0.8 + fbm(x * 0.05, z * 0.05, 3) * 0.35);
          if (slope > 0.28) c.lerp(rock, Math.min((slope - 0.28) * 2.6, 1));
        }
      },
    });

    kit.water({ level: 0, deep: '#22504a', shallow: '#8fb9a8', swellAmp: 0.045, swellFreq: 0.85, sparkle: 1.2 });

    // ----- vegetation -----
    const heroMaple = { x: -25, z: 40 };
    const seat = { x: 70, z: 30 };
    const farFromHeroes = (x, z, r = 13) =>
      (x - heroMaple.x) ** 2 + (z - heroMaple.z) ** 2 > r * r && (x - seat.x) ** 2 + (z - seat.z) ** 2 > 11 * 11;

    const redMaple = kit.treeGeo('maple', { canopy: '#c2491f', canopyB: '#e8852f' });
    const goldMaple = kit.treeGeo('maple', { canopy: '#d9912f', canopyB: '#edc24f' });
    const pine = kit.treeGeo('pine', { canopy: '#2e4f33', canopyB: '#4a6e42', trunk: '#4a3a2a' });

    const treePlace = (grove) => (i, rng) => {
      const x = (rng() * 2 - 1) * 260;
      const z = (rng() * 2 - 1) * 260;
      const d = Math.abs(x - riverX(z));
      if (d < 15 || !farFromHeroes(x, z)) return null;
      const w = 0.16 + gauss(x, z, grove.x, grove.z, 38) * 1.1 + gauss(x, z, grove.x2, grove.z2, 30) * 0.7;
      if (rng() > w * smooth(220, 120, Math.abs(x)) || height(x, z) > 34) return null;
      return { x, z, s: 0.85 + rng() * 0.8 };
    };
    kit.scatter(redMaple, { count: 130, place: treePlace({ x: -62, z: -8, x2: -40, z2: 110, }), sway: { amp: 0.05, speed: 1.1, maxY: 4 } });
    kit.scatter(goldMaple, { count: 110, place: treePlace({ x: -95, z: 70, x2: 60, z2: -90 }), sway: { amp: 0.05, speed: 1.0, maxY: 4 } });
    kit.scatter(pine, {
      count: 70,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 290;
        const z = (rng() * 2 - 1) * 290;
        const d = Math.abs(x - riverX(z));
        const h = height(x, z);
        if (d < 100 || h < 18 || h > 60) return null;
        return { x, z, s: 1 + rng() * 1.1 };
      },
      sway: { amp: 0.04, speed: 0.9, maxY: 4 },
    });

    // the lone riverbank maple, larger than its kin (stage 2 subject)
    const heroY = kit.heightAt(heroMaple.x, heroMaple.z);
    kit.scatter(redMaple, {
      count: 1,
      place: () => ({ x: heroMaple.x, z: heroMaple.z, s: 2.3, rot: 0.8 }),
      sway: { amp: 0.06, speed: 1.0, maxY: 4 },
    });

    const grass = kit.grassGeo({ a: '#74883c', b: '#cdb35a' });
    kit.scatter(grass, {
      count: 2400,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 130;
        const z = (rng() * 2 - 1) * 150;
        const d = Math.abs(x - riverX(z));
        if (d < 12.5 || d > 95) return null;
        return { x, z, s: 0.8 + rng() * 1.1 };
      },
      sway: { amp: 0.1, speed: 1.7, maxY: 0.55 },
    });

    const flower = kit.flowerGeo({ petal: '#eef0f8', center: '#e8b34b' });
    kit.scatter(flower, {
      count: 260,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 120;
        const z = (rng() * 2 - 1) * 120;
        const d = Math.abs(x - riverX(z));
        const w = 0.25 + gauss(x, z, 64, 26, 22) * 1.4;
        if (d < 13 || rng() > w) return null;
        return { x, z, s: 0.9 + rng() * 0.9 };
      },
      sway: { amp: 0.05, speed: 1.9, maxY: 0.4 },
    });

    // rocks: a riffle mid-river plus scattered bank stones
    const rockGeo = kit.rockGeo({ color: '#857d72' });
    const riffleRocks = [
      { x: 16, z: 53, y: -0.45, s: 1.5 },
      { x: 19.5, z: 56, y: -0.2, s: 1.1 },
      { x: 14, z: 58, y: -0.6, s: 1.9 },
      { x: 21.5, z: 60.5, y: 0.05, s: 0.8 },
      { x: 17.5, z: 62, y: -0.35, s: 1.3 },
    ];
    kit.scatter(rockGeo, {
      count: riffleRocks.length + 36,
      place: (i, rng) => {
        if (i < riffleRocks.length) return riffleRocks[i];
        const x = (rng() * 2 - 1) * 150;
        const z = (rng() * 2 - 1) * 150;
        const d = Math.abs(x - riverX(z));
        if (d < 11 || d > 60) return null;
        return { x, z, s: 0.3 + rng() * 1.2 };
      },
    });

    // torii gate on the far bank, framing the grove
    kit.torii(new THREE.Vector3(-50, kit.heightAt(-50, 14), 14), 1.25, 1.35);

    // drifting autumn leaves + dusk fireflies
    kit.petals({ count: 850, colorA: '#c2491f', colorB: '#e8a13a', size: 5.0, fall: 0.55, wind: [2.2, 0.8] });
    kit.fireflies({ count: 120, center: [0, 7, 30], box: [220, 22, 240] });

    // ----- micro scene: wildflowers + dragonfly on the bluff -----
    const microC = { x: 67.4, z: 26.4 };
    const microY = kit.heightAt(microC.x, microC.z);
    kit.wildflowerPatch(new THREE.Vector3(microC.x, microY, microC.z), { count: 9, radius: 0.5 });
    kit.scatter(grass, {
      count: 60,
      place: (i, rng) => {
        const ang = rng() * Math.PI * 2;
        const r = 0.3 + rng() * 1.6;
        return { x: microC.x + Math.cos(ang) * r, z: microC.z + Math.sin(ang) * r, s: 0.5 + rng() * 0.6 };
      },
      sway: { amp: 0.08, speed: 2.0, maxY: 0.55 },
    });
    kit.scatter(rockGeo, {
      count: 2,
      place: (i) => (i === 0 ? { x: 67.95, z: 26.0, s: 0.14 } : { x: 66.8, z: 27.1, s: 0.1 }),
    });
    const dewRockY = kit.heightAt(67.95, 26.0);
    kit.dragonfly(new THREE.Vector3(67.5, microY + 0.6, 26.8), { scale: 1 });

    // ----- camera stations -----
    const seatY = kit.heightAt(seat.x, seat.z) + 1.15;
    const seatPos = new THREE.Vector3(seat.x, seatY, seat.z);
    const seated = kit.poseLook(seatPos, new THREE.Vector3(-25, 6, -20), 58);

    const stage1 = kit.station(
      seatPos,
      [
        { pos: new THREE.Vector3(-50, kit.heightAt(-55, 4) + 7, 2) }, // maple grove + torii across the river
        { pos: new THREE.Vector3(17.5, 0.7, 57.5) }, // the riffle
        { pos: new THREE.Vector3(-88, kit.heightAt(-88, 98) + 9, 98) }, // golden grove downstream
      ],
      { fov: 40, dotScale: 2.4 }
    );

    const st2cam = new THREE.Vector3(-11, kit.heightAt(-11, 53) + 1.7, 53);
    const stage2 = kit.station(
      st2cam,
      [
        { pos: new THREE.Vector3(-25, heroY + 6.4, 40) }, // crown
        { pos: new THREE.Vector3(-23.8, heroY + 0.9, 41.6) }, // roots
        { pos: new THREE.Vector3(-21.2, heroY + 4.0, 44.0) }, // branch over the water
      ],
      { fov: 44, dotScale: 0.55 }
    );

    const st3cam = new THREE.Vector3(66.1, microY + 0.95, 25.1);
    const stage3 = kit.station(
      st3cam,
      [
        { pos: new THREE.Vector3(67.25, microY + 0.45, 26.25) }, // flower heads
        { pos: new THREE.Vector3(67.5, microY + 0.6, 26.8) }, // the dragonfly
        { pos: new THREE.Vector3(67.95, dewRockY + 0.16, 26.0) }, // a stone holding the light
      ],
      { fov: 40, dotScale: 0.085 }
    );

    const flyover = [
      new THREE.Vector3(40, 95, 275),
      new THREE.Vector3(-35, 55, 185),
      new THREE.Vector3(-58, 28, 95),
      new THREE.Vector3(-24, 15, 25),
      new THREE.Vector3(22, 18, -8),
      new THREE.Vector3(56, 26, 8),
      seatPos.clone(),
    ];
    const finale = [
      seatPos.clone(),
      new THREE.Vector3(45, 38, -25),
      new THREE.Vector3(-30, 58, 45),
      new THREE.Vector3(-25, 85, 170),
      new THREE.Vector3(50, 112, 265),
    ];

    return {
      seated,
      stages: [stage1, stage2, stage3],
      flyover,
      finale,
      finaleLook: new THREE.Vector3(-10, 6, 10),
    };
  },
};

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
