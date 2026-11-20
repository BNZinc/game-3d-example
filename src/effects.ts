import * as THREE from "three";
import { rng } from "./noise";

/** Lanterns, fireflies, sparkle bursts and birds — the things that make the island feel alive. */

function radialTexture(inner: string, outer: string, size = 128): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowTex = radialTexture("rgba(255,240,210,1)", "rgba(255,170,90,0.35)");

// Shared lantern geometry: a round paper lantern with wooden caps.
const bodyGeo = (() => {
  const pts: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const y = -0.34 + (i / n) * 0.68;
    const r = 0.06 + 0.24 * Math.sqrt(Math.max(0, 1 - (y / 0.36) ** 2));
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 12);
})();
const capGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.07, 12);
const loopGeo = new THREE.TorusGeometry(0.07, 0.012, 6, 12);
const woodMat = new THREE.MeshStandardMaterial({ color: "#5b3b26", roughness: 0.9, flatShading: true });

export const LANTERN_COLORS = ["#ffb347", "#ff9a3c", "#ffc864", "#ffa552"];

export type LanternState = "idle" | "collecting" | "rising" | "sky";

export class Lantern {
  readonly group = new THREE.Group();
  readonly base = new THREE.Vector3();
  state: LanternState = "idle";
  private readonly paper: THREE.MeshStandardMaterial;
  private readonly halo: THREE.Sprite;
  private readonly pool: THREE.Mesh | null = null;
  private readonly phase: number;
  private t = 0;
  private readonly drift = new THREE.Vector3();
  private skyY = 0;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, color: string, phase: number, withPool: boolean) {
    this.phase = phase;
    this.base.copy(pos);
    this.paper = new THREE.MeshStandardMaterial({
      color: "#ffcf96",
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.0,
      roughness: 0.55,
      flatShading: true,
    });
    const body = new THREE.Mesh(bodyGeo, this.paper);
    body.castShadow = false;
    const top = new THREE.Mesh(capGeo, woodMat);
    top.position.y = 0.36;
    const bottom = new THREE.Mesh(capGeo, woodMat);
    bottom.position.y = -0.36;
    const loop = new THREE.Mesh(loopGeo, woodMat);
    loop.position.y = 0.45;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(2.3);
    this.group.add(body, top, bottom, loop, this.halo);
    this.group.scale.setScalar(1.35);
    this.group.position.copy(pos);
    scene.add(this.group);

    if (withPool) {
      const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
      this.pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), poolMat);
      this.pool.rotation.x = -Math.PI / 2;
      this.pool.position.set(pos.x, pos.y + 0.08, pos.z);
      scene.add(this.pool);
    }
  }

  /** Floating height above its base while waiting. */
  get hover(): THREE.Vector3 {
    return this.group.position;
  }

  collect(windDir: THREE.Vector3) {
    if (this.state !== "idle") return;
    this.state = "collecting";
    this.t = 0;
    this.drift.copy(windDir).multiplyScalar(0.6 + Math.random() * 0.5);
    this.skyY = 22 + Math.random() * 14;
  }

  /** Puts the lantern straight into the evening sky (decoration). */
  setSky(pos: THREE.Vector3, wind: THREE.Vector3) {
    this.state = "sky";
    this.group.position.copy(pos);
    this.skyY = pos.y;
    this.drift.copy(wind);
    if (this.pool) this.pool.visible = false;
  }

  reset() {
    this.state = "idle";
    this.t = 0;
    this.group.position.copy(this.base);
    this.group.scale.setScalar(1.35);
    if (this.pool) {
      this.pool.visible = true;
      (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.3;
    }
  }

  update(dt: number, time: number, camPos?: THREE.Vector3) {
    // Far-away lanterns get a larger glow so they still read as points of light.
    if (camPos) {
      const d = this.group.position.distanceTo(camPos);
      this.halo.scale.setScalar(2.3 + Math.max(0, d - 15) * 0.035);
    }
    const flicker = 1 + Math.sin(time * 7 + this.phase * 5) * 0.05 + Math.sin(time * 13.1 + this.phase) * 0.04;
    this.paper.emissiveIntensity = 1.0 * flicker;
    this.halo.material.opacity = 0.38 * flicker;
    const g = this.group;
    if (this.state === "idle") {
      g.position.y = this.base.y + 1.35 + Math.sin(time * 1.6 + this.phase) * 0.22;
      g.rotation.y += dt * 0.5;
      g.rotation.z = Math.sin(time * 1.1 + this.phase) * 0.06;
    } else if (this.state === "collecting") {
      this.t += dt;
      const k = Math.min(this.t / 0.35, 1);
      g.scale.setScalar(1.35 * (1 + Math.sin(k * Math.PI) * 0.45));
      g.position.y += dt * 2;
      if (this.pool) (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - k);
      if (k >= 1) {
        this.state = "rising";
        if (this.pool) this.pool.visible = false;
      }
    } else if (this.state === "rising") {
      this.t += dt;
      const speed = 2.2 + Math.min(this.t, 3) * 0.6;
      g.position.y += dt * speed * (g.position.y < this.skyY ? 1 : 0);
      g.position.addScaledVector(this.drift, dt);
      g.rotation.z = Math.sin(time * 1.4 + this.phase) * 0.12;
      if (g.position.y >= this.skyY) this.state = "sky";
    } else {
      g.position.addScaledVector(this.drift, dt * 0.35);
      g.position.y = this.skyY + Math.sin(time * 0.7 + this.phase) * 0.5;
      g.rotation.z = Math.sin(time * 0.9 + this.phase) * 0.08;
    }
  }
}

/** Fireflies that wake up as it gets dark. */
export function createFireflies(scene: THREE.Scene, heightAt: (x: number, z: number) => number, count = 260) {
  const r = rng(99);
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  let i = 0;
  let tries = 0;
  while (i < count && tries++ < count * 50) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 42;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const y = heightAt(x, z);
    if (y < 0.8) continue;
    pos.set([x, y + 0.5 + r() * 2.5, z], i * 3);
    phase[i] = r() * 100;
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.3 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale;
      attribute float aPhase;
      varying float vGlow;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.6 + aPhase) * 0.9;
        p.z += cos(uTime * 0.5 + aPhase * 1.3) * 0.9;
        p.y += sin(uTime * 0.9 + aPhase * 0.7) * 0.4;
        vGlow = 0.5 + 0.5 * sin(uTime * 2.2 + aPhase * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 70.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.45) * a * vGlow * uIntensity * 2.0, 1.0);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    update(time: number, dusk: number, pixelRatio: number) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uIntensity.value = 0.25 + THREE.MathUtils.smoothstep(dusk, 0.1, 0.9) * 0.9;
      mat.uniforms.uScale.value = pixelRatio;
    },
  };
}

/** Sparkle burst when a lantern is picked up. */
export function createBursts(scene: THREE.Scene, max = 160) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const alpha = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float aAlpha;
      varying float vA;
      void main() {
        vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uScale * 90.0 * (0.4 + aAlpha) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * a * vA * 3.0, 1.0);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  return {
    spawn(at: THREE.Vector3, n: number) {
      for (let k = 0; k < n; k++) {
        const i = next;
        next = (next + 1) % max;
        const a = Math.random() * Math.PI * 2;
        const up = Math.random();
        const sp = 1.5 + Math.random() * 3;
        pos.set([at.x, at.y, at.z], i * 3);
        vel.set([Math.cos(a) * sp * (1 - up * 0.5), 1 + up * 4, Math.sin(a) * sp * (1 - up * 0.5)], i * 3);
        life[i] = 0.8 + Math.random() * 0.8;
      }
    },
    update(dt: number, pixelRatio: number) {
      mat.uniforms.uScale.value = pixelRatio;
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) {
          alpha[i] = 0;
          continue;
        }
        life[i] -= dt;
        vel[i * 3 + 1] -= dt * 3;
        vel[i * 3] *= 1 - dt * 1.5;
        vel[i * 3 + 2] *= 1 - dt * 1.5;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        alpha[i] = Math.max(0, Math.min(1, life[i]));
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
  };
}

/** A few sea birds gliding in wide circles. */
export function createBirds(scene: THREE.Scene, count = 7) {
  const mat = new THREE.MeshBasicMaterial({ color: "#3a2b36", side: THREE.DoubleSide });
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, -0.18, 0, 0, 0.22, 0.9, 0.05, -0.05]), 3));
  wing.computeVertexNormals();
  const birds: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; rad: number; h: number; sp: number; ph: number }[] = [];
  const rnd = rng(5);
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const l = new THREE.Mesh(wing, mat);
    const r = new THREE.Mesh(wing, mat);
    r.scale.x = -1;
    g.add(l, r);
    g.scale.setScalar(0.6 + rnd() * 0.3);
    scene.add(g);
    birds.push({ g, l, r, rad: 18 + rnd() * 24, h: 13 + rnd() * 8, sp: (0.08 + rnd() * 0.06) * (rnd() > 0.5 ? 1 : -1), ph: rnd() * 6.28 });
  }
  return {
    update(time: number) {
      for (const b of birds) {
        const a = time * b.sp + b.ph;
        b.g.position.set(Math.cos(a) * b.rad, b.h + Math.sin(time * 0.5 + b.ph) * 1.5, Math.sin(a) * b.rad);
        // face along the circle
        b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI);
        const flap = Math.sin(time * 7 + b.ph * 3);
        const glide = Math.sin(time * 0.6 + b.ph) > 0.3 ? 0.15 : 1;
        b.l.rotation.z = flap * 0.55 * glide;
        b.r.rotation.z = -flap * 0.55 * glide;
      }
    },
  };
}
