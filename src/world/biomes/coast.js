// Sea cliffs at sunset: rolling surf, pampas grass bowing in the wind,
// a lone wind-bent pine on the bluff, spray drifting up the rock.

import * as THREE from 'three';

const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

export default {
  name: 'coast',
  ambience: 'coast',

  build(kit) {
    const { fbm } = kit;

    // ocean lies to the west (negative X); coastline wanders with z
    const coastX = (z) => -12 + 14 * Math.sin(z * 0.01) + 8 * Math.sin(z * 0.023 + 2.1);
    const height = (x, z) => {
      const d = x - coastX(z); // positive inland
      let h;
      if (d < 0) {
        h = -7 + 20.5 * smooth(-16, 0, d); // the cliff face plunging to the sea
      } else {
        h = 13.5 + smooth(0, 70, d) * 9 + fbm(x * 0.012 + 9.1, z * 0.012 + 4.4, 4) * 11;
        h += 8 * gauss(x, z, 10, 2, 34); // the promontory the player sits on
        h += smooth(160, 320, d) * 40; // hills inland
      }
      return h;
    };

    kit.fog('#eec096', 110, 540);
    kit.lights({
      hemiSky: '#ffd9b0',
      hemiGround: '#6b6248',
      hemiI: 0.95,
      sunColor: '#ffc888',
      sunI: 2.1,
      sunDir: new THREE.Vector3(-0.94, 0.17, -0.18),
    });
    kit.sky({ top: '#5d6e96', horizon: '#f7b27a', bottom: '#7c6a58', sunSize: 0.055 });
    kit.ridges([
      { radius: 330, height: 70, color: '#bd9272', seed: 5 },
      { radius: 430, height: 120, color: '#d2ab84', seed: 6 },
    ]);
    kit.clouds({ color: '#ffe3c4', opacity: 0.6, count: 11 });

    const meadow1 = new THREE.Color('#8c8a44');
    const meadow2 = new THREE.Color('#c4ad5a');
    const cliffRock = new THREE.Color('#6e6358');
    const wetRock = new THREE.Color('#4c443c');
    kit.terrain({
      height,
      color: (c, x, z, h, slope, rng) => {
        const d = x - coastX(z);
        if (d < 1.5) {
          c.copy(h < 1.2 ? wetRock : cliffRock).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
        } else {
          c.copy(meadow1).lerp(meadow2, fbm(x * 0.04, z * 0.04, 3) * 0.9);
          if (slope > 0.3) c.lerp(cliffRock, Math.min((slope - 0.3) * 2.4, 1));
        }
      },
    });

    kit.water({
      level: 0,
      size: 900,
      deep: '#1d3a52',
      shallow: '#7fb4c4',
      swellAmp: 0.5,
      swellFreq: 0.16,
      sparkle: 1.5,
    });

    // sea stacks standing in the surf
    const rockGeo = kit.rockGeo({ color: '#6e6358' });
    kit.scatter(rockGeo, {
      count: 3,
      place: (i) =>
        [
          { x: -90, z: -68, y: -3, s: 11 },
          { x: -125, z: 55, y: -4, s: 15 },
          { x: -70, z: 130, y: -3, s: 8 },
        ][i],
    });
    kit.scatter(rockGeo, {
      count: 40,
      place: (i, rng) => {
        const z = (rng() * 2 - 1) * 200;
        const d = rng() * 30 + 2;
        return { x: coastX(z) + d, z, s: 0.3 + rng() * 1.4 };
      },
    });

    // ----- vegetation -----
    const heroPine = { x: -2, z: -40 };
    const seat = { x: 8, z: 2 };

    const pampas = kit.pampasGeo({ plume: '#f2e6cc' });
    kit.scatter(pampas, {
      count: 1500,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 170;
        const z = (rng() * 2 - 1) * 200;
        const d = x - coastX(z);
        if (d < 5 || d > 130) return null;
        if ((x - heroPine.x) ** 2 + (z - heroPine.z) ** 2 < 10 * 10) return null;
        if ((x - seat.x) ** 2 + (z - seat.z) ** 2 < 8 * 8) return null;
        const w = 0.3 + gauss(x, z, 40, -60, 45) * 0.9 + gauss(x, z, 30, 80, 40) * 0.7;
        if (rng() > w) return null;
        return { x, z, s: 0.75 + rng() * 0.7 };
      },
      sway: { amp: 0.22, speed: 1.9, maxY: 1.7 },
    });

    const grass = kit.grassGeo({ a: '#85893f', b: '#d4bb60' });
    kit.scatter(grass, {
      count: 1700,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 150;
        const z = (rng() * 2 - 1) * 180;
        const d = x - coastX(z);
        if (d < 4 || d > 120) return null;
        return { x, z, s: 0.8 + rng() * 1.1 };
      },
      sway: { amp: 0.14, speed: 2.1, maxY: 0.55 },
    });

    const pine = kit.treeGeo('pine', { canopy: '#33523a', canopyB: '#5d7a47', trunk: '#54422f' });
    kit.scatter(pine, {
      count: 42,
      place: (i, rng) => {
        const x = (rng() * 2 - 1) * 240;
        const z = (rng() * 2 - 1) * 240;
        const d = x - coastX(z);
        if (d < 28 || d > 230) return null;
        if ((x - heroPine.x) ** 2 + (z - heroPine.z) ** 2 < 16 * 16) return null;
        if (rng() > 0.4) return null;
        return { x, z, s: 1 + rng() * 1.2 };
      },
      sway: { amp: 0.06, speed: 1.2, maxY: 4 },
    });

    // the lone wind-bent pine at the cliff edge (stage 2 subject)
    const heroY = kit.heightAt(heroPine.x, heroPine.z);
    kit.scatter(pine, {
      count: 1,
      place: () => ({ x: heroPine.x, z: heroPine.z, s: 2.1, rot: 2.4 }),
      sway: { amp: 0.09, speed: 1.4, maxY: 4 },
    });

    // drifting seed-fluff + surf spray
    kit.petals({
      count: 500,
      colorA: '#f2e6cc',
      colorB: '#d9c89a',
      size: 3.4,
      fall: 0.18,
      wind: [4.4, 1.2],
      swirl: 2.2,
      center: [0, 22, 0],
      box: [340, 60, 340],
    });
    kit.spray({ center: [coastX(0) - 16, 3, 0], box: [44, 12, 320], count: 320, rise: 1.5 });

    // ----- micro scene: a seed-head and a butterfly by the seat -----
    const microC = { x: 5.4, z: 11.5 };
    const microY = kit.heightAt(microC.x, microC.z);
    kit.scatter(pampas, {
      count: 5,
      place: (i, rng) => {
        const ang = (i / 5) * Math.PI * 2;
        const r = 0.25 + rng() * 0.5;
        return { x: microC.x + Math.cos(ang) * r, z: microC.z + Math.sin(ang) * r, s: 0.85 + rng() * 0.3 };
      },
      sway: { amp: 0.2, speed: 1.8, maxY: 1.7 },
    });
    kit.scatter(grass, {
      count: 70,
      place: (i, rng) => {
        const ang = rng() * Math.PI * 2;
        const r = 0.3 + rng() * 1.8;
        return { x: microC.x + Math.cos(ang) * r, z: microC.z + Math.sin(ang) * r, s: 0.5 + rng() * 0.7 };
      },
      sway: { amp: 0.1, speed: 2.2, maxY: 0.55 },
    });
    kit.butterfly(new THREE.Vector3(microC.x + 0.4, microY + 1.25, microC.z + 0.4), { color: '#e8943a' });

    // ----- camera stations -----
    const seatY = kit.heightAt(seat.x, seat.z) + 1.15;
    const seatPos = new THREE.Vector3(seat.x, seatY, seat.z);
    const seated = kit.poseLook(seatPos, new THREE.Vector3(-80, 4, -25), 58);

    const stage1 = kit.station(
      seatPos,
      [
        { pos: new THREE.Vector3(-68, 1.2, 48) }, // the surf line breaking
        { pos: new THREE.Vector3(42, kit.heightAt(42, -62) + 1.6, -62) }, // pampas crest catching light
        { pos: new THREE.Vector3(-90, 7, -68) }, // the sea stack
      ],
      { fov: 40, dotScale: 2.4 }
    );

    const st2cam = new THREE.Vector3(11, kit.heightAt(11, -31) + 1.7, -31);
    const stage2 = kit.station(
      st2cam,
      [
        { pos: new THREE.Vector3(heroPine.x + 0.8, heroY + 7.4, heroPine.z) }, // wind-combed crown
        { pos: new THREE.Vector3(heroPine.x - 0.6, heroY + 1.0, heroPine.z + 1.2) }, // roots gripping rock
        { pos: new THREE.Vector3(heroPine.x + 2.6, heroY + 4.2, heroPine.z - 1.6) }, // the leaning trunk
      ],
      { fov: 44, dotScale: 0.55 }
    );

    const st3cam = new THREE.Vector3(microC.x - 1.3, microY + 1.3, microC.z - 1.4);
    const stage3 = kit.station(
      st3cam,
      [
        { pos: new THREE.Vector3(microC.x, microY + 1.55, microC.z) }, // the seed-head
        { pos: new THREE.Vector3(microC.x + 0.4, microY + 1.25, microC.z + 0.4) }, // the butterfly
        { pos: new THREE.Vector3(microC.x - 0.5, microY + 0.5, microC.z + 0.3) }, // bowing grass blades
      ],
      { fov: 40, dotScale: 0.085 }
    );

    const flyover = [
      new THREE.Vector3(-230, 75, 170),
      new THREE.Vector3(-170, 42, 70),
      new THREE.Vector3(-95, 22, -15),
      new THREE.Vector3(-40, 14, 35),
      new THREE.Vector3(-12, 20, 18),
      seatPos.clone(),
    ];
    const finale = [
      seatPos.clone(),
      new THREE.Vector3(-25, 32, -45),
      new THREE.Vector3(-90, 50, 15),
      new THREE.Vector3(-150, 78, 115),
      new THREE.Vector3(-205, 108, 215),
    ];

    return {
      seated,
      stages: [stage1, stage2, stage3],
      flyover,
      finale,
      finaleLook: new THREE.Vector3(-20, 8, 0),
    };
  },
};

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
