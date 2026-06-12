// Camera rig: spline flyovers, smooth travel between vantage points, and the
// seated "look around" control clamped to a per-station cone. Poses are
// { pos: Vector3, yaw, pitch, fov } with yaw/pitch in radians (YXZ order).

import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function poseQuat(pose, out = new THREE.Quaternion()) {
  _e.set(pose.pitch, pose.yaw, 0, 'YXZ');
  return out.setFromEuler(_e);
}

// yaw/pitch that aim a camera at `target` from `pos`
export function lookPose(pos, target) {
  _v1.copy(target).sub(pos);
  const yaw = Math.atan2(-_v1.x, -_v1.z);
  const pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
  return { yaw, pitch };
}

const easeInOut = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) ** 3;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.mode = 'idle';
    this.station = null;
    // look state (seated mode)
    this.baseYaw = 0;
    this.basePitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.curYaw = 0;
    this.curPitch = 0;
    this.breathT = 0;
    this._anim = null;
  }

  setPose(pose) {
    this.mode = 'idle';
    this.camera.position.copy(pose.pos);
    this.camera.quaternion.copy(poseQuat(pose, _q1));
    if (pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Fly a Catmull-Rom spline. Orientation follows the path tangent, optionally
  // drawn toward `lookAt` (fixed point) and blended into `endPose` at the end.
  playPath(points, { duration = 20, lookAt = null, endPose = null, startFov = 58, endFov = 55 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const endQuat = endPose ? poseQuat(endPose, new THREE.Quaternion()) : null;
    this.mode = 'path';
    return new Promise((resolve) => {
      this._anim = {
        kind: 'path',
        curve,
        t: 0,
        duration,
        lookAt,
        endPose,
        endQuat,
        startFov,
        endFov,
        resolve,
      };
    });
  }

  skipPath() {
    if (this._anim?.kind === 'path') this._anim.t = 1e9; // finish on next update
  }

  // Smooth pan/zoom from the current pose to another (visible, not faded).
  travelTo(pose, duration = 3) {
    this.mode = 'travel';
    const from = {
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
      fov: this.camera.fov,
    };
    const toQuat = poseQuat(pose, new THREE.Quaternion());
    return new Promise((resolve) => {
      this._anim = { kind: 'travel', t: 0, duration, from, to: pose, toQuat, resolve };
    });
  }

  // Seated composing mode: free look inside the station's cone.
  setSeated(station) {
    this.mode = 'seated';
    this.station = station;
    this.baseYaw = station.yaw;
    this.basePitch = station.pitch;
    this.targetYaw = station.yaw;
    this.targetPitch = station.pitch;
    this.curYaw = this.camera.rotation.y;
    this.curPitch = this.camera.rotation.x;
    this.camera.position.copy(station.pos);
    if (station.fov) {
      this.camera.fov = station.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  applyLook(dx, dy) {
    if (this.mode !== 'seated' || !this.station) return;
    const s = this.station;
    this.targetYaw = clamp(this.targetYaw - dx, this.baseYaw - s.coneYaw, this.baseYaw + s.coneYaw);
    this.targetPitch = clamp(this.targetPitch - dy, this.basePitch - s.conePitch, this.basePitch + s.conePitch);
  }

  update(dt) {
    const a = this._anim;
    if (this.mode === 'path' && a) {
      a.t += dt / a.duration;
      const done = a.t >= 1;
      const t = easeInOut(clamp(a.t, 0, 1));
      const p = a.curve.getPoint(t);
      this.camera.position.copy(p);

      // look along the path, a touch ahead
      const ahead = a.curve.getPoint(Math.min(t + 0.035, 1));
      let target = _v1.copy(ahead);
      if (a.lookAt) target.lerp(a.lookAt, 0.72);
      if (target.distanceToSquared(p) < 0.01) target = _v1.copy(p).add(_v2.set(0, 0, -1));
      this.camera.lookAt(target);

      // settle into the end pose over the final stretch
      if (a.endQuat) {
        const blend = smooth01((t - 0.8) / 0.2);
        if (blend > 0) {
          if (a.endPose.pos) this.camera.position.lerp(a.endPose.pos, blend);
          this.camera.quaternion.slerp(a.endQuat, blend);
        }
      }
      this.camera.fov = a.startFov + (a.endFov - a.startFov) * t;
      this.camera.updateProjectionMatrix();
      if (done) {
        this._anim = null;
        this.mode = 'idle';
        if (a.endPose) this.setPose(a.endPose);
        a.resolve();
      }
    } else if (this.mode === 'travel' && a) {
      a.t += dt / a.duration;
      const done = a.t >= 1;
      const t = easeInOut(clamp(a.t, 0, 1));
      this.camera.position.lerpVectors(a.from.pos, a.to.pos, t);
      this.camera.quaternion.slerpQuaternions(a.from.quat, a.toQuat, t);
      this.camera.fov = a.from.fov + ((a.to.fov ?? a.from.fov) - a.from.fov) * t;
      this.camera.updateProjectionMatrix();
      if (done) {
        this._anim = null;
        this.mode = 'idle';
        a.resolve();
      }
    } else if (this.mode === 'seated') {
      // critically-damped-ish smoothing toward the look target
      const k = 1 - Math.exp(-dt * 7.5);
      this.curYaw = this.camera.rotation.y + (this.targetYaw - this.camera.rotation.y) * k;
      this.curPitch = this.camera.rotation.x + (this.targetPitch - this.camera.rotation.x) * k;
      // meditative breathing: a barely-there rise and fall
      this.breathT += dt;
      const breath = Math.sin(this.breathT * 2 * Math.PI * 0.11) * 0.0016;
      this.camera.rotation.set(this.curPitch + breath, this.curYaw, 0, 'YXZ');
    }
  }

  // Angular offset of a world point from the view center + its screen position.
  focusOf(worldPos, out = {}) {
    const cam = this.camera;
    _v1.copy(worldPos).sub(cam.position).normalize();
    cam.getWorldDirection(_v2);
    const angle = _v2.angleTo(_v1);
    _v1.copy(worldPos).project(cam);
    out.angle = angle;
    out.behind = _v1.z > 1;
    out.x = (_v1.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-_v1.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smooth01(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
