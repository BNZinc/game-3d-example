import * as THREE from "three";
import { loadModelWithClips } from "./assets";
import type { InputState } from "./input";
import type { Collider } from "./world";

/** The fox: movement, jumping, simple collisions and animation blending. */

const WALK = 5.2;
const RUN = 9;
const GRAVITY = 24;
const JUMP = 8;
const RADIUS = 0.45;

export class Player {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  heading = Math.PI; // facing -Z (towards the island centre from the spawn beach)
  onGround = true;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = "";
  private stepBob = 0;
  private placeholder: THREE.Object3D;

  constructor(scene: THREE.Scene) {
    // Placeholder until the fox model loads.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: "#d86b2c" }));
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.45;
    body.castShadow = true;
    this.placeholder = body;
    this.root.add(body);
    scene.add(this.root);
  }

  async load() {
    const fox = await loadModelWithClips("assets/fox.glb");
    if (!fox) return;
    this.root.remove(this.placeholder);
    fox.scene.scale.setScalar(1.25);
    fox.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.8;
        mat.metalness = 0;
        mat.flatShading = true;
        m.frustumCulled = false;
      }
    });
    this.root.add(fox.scene);
    this.mixer = new THREE.AnimationMixer(fox.scene);
    for (const clip of fox.clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play("Idle", 0);
  }

  private play(name: string, fade = 0.25) {
    if (name === this.current) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.actions[this.current];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = name;
  }

  get position() {
    return this.root.position;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  reset(x: number, y: number, z: number, heading: number) {
    this.root.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this.root.rotation.y = heading;
    this.onGround = true;
  }

  update(
    dt: number,
    input: InputState | null,
    camYaw: number,
    groundAt: (x: number, z: number) => number,
    colliders: Collider[],
  ): { jumped: boolean; landed: boolean } {
    const p = this.root.position;
    let jumped = false;
    let landed = false;

    // Desired horizontal velocity in world space, relative to the camera.
    const mx = input?.move.x ?? 0;
    const my = input?.move.y ?? 0;
    const fwdX = -Math.sin(camYaw);
    const fwdZ = -Math.cos(camYaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const target = (input?.run ? RUN : WALK) * Math.min(1, Math.hypot(mx, my));
    let dx = fwdX * my + rightX * mx;
    let dz = fwdZ * my + rightZ * mx;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) {
      dx /= dl;
      dz /= dl;
    }
    const accel = this.onGround ? 14 : 5;
    this.velocity.x += (dx * target - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (dz * target - this.velocity.z) * Math.min(1, accel * dt);

    if (dl > 0.01) {
      const want = Math.atan2(dx, dz);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 12);
    }
    this.root.rotation.y = this.heading;

    if (input?.jump && this.onGround) {
      this.velocity.y = JUMP;
      this.onGround = false;
      jumped = true;
    }

    // Move with sliding collisions against round obstacles.
    let nx = p.x + this.velocity.x * dt;
    let nz = p.z + this.velocity.z * dt;
    for (const c of colliders) {
      const ddx = nx - c.x;
      const ddz = nz - c.z;
      const min = c.r + RADIUS;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = c.x + (ddx / d) * min;
        nz = c.z + (ddz / d) * min;
      }
    }
    // Keep out of deep water: the fox can paddle in the shallows only.
    const g = groundAt(nx, nz);
    if (g > -0.45) {
      // Don't climb walls taller than a small step unless jumping over them.
      const here = groundAt(p.x, p.z);
      if (g - Math.max(here, p.y) < 1.1 || !this.onGround) {
        p.x = nx;
        p.z = nz;
      }
    } else {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }

    this.velocity.y -= GRAVITY * dt;
    p.y += this.velocity.y * dt;
    const floor = Math.max(groundAt(p.x, p.z), -0.35);
    if (p.y <= floor) {
      if (!this.onGround && this.velocity.y < -4) landed = true;
      p.y = floor;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (p.y > floor + 0.25) {
      this.onGround = false;
    } else if (this.onGround) {
      p.y = floor; // stick to slopes when walking down
    }

    // Animation
    const sp = this.speed;
    if (this.mixer) {
      if (!this.onGround) this.play("Run", 0.15);
      else if (sp < 0.4) this.play("Idle");
      else if (sp < WALK + 0.8) this.play("Walk");
      else this.play("Run");
      const a = this.actions[this.current];
      if (a && this.current === "Walk") a.timeScale = Math.max(0.6, sp / 3.2);
      if (a && this.current === "Run") a.timeScale = this.onGround ? Math.max(0.8, sp / 8) : 0.6;
      this.mixer.update(dt);
    } else {
      this.stepBob += dt * sp * 2;
      this.placeholder.position.y = 0.45 + Math.abs(Math.sin(this.stepBob)) * 0.08;
    }
    return { jumped, landed };
  }
}
