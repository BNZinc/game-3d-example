import * as THREE from "three";
import { loadModel } from "./assets";
import { rng } from "./noise";
import { COTTAGE, LIGHTHOUSE, SPAWN, distToPath, type Terrain } from "./terrain";

/** Trees, rocks, buildings and the pier: loads the Polyfork models and places them on the island. */

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface Deck {
  /** Walkable rectangle in world space (centre, half sizes, rotation around Y). */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
  y: number;
}

export interface World {
  colliders: Collider[];
  decks: Deck[];
  /** Ground height including walkable decks. */
  groundAt(x: number, z: number): number;
  /** Things that animate every frame. */
  update(time: number, dusk: number): void;
  pierEnd: THREE.Vector3;
  pierStart: THREE.Vector3;
  lighthouseLamp: THREE.Vector3;
}

const swayUniforms = { uTime: { value: 0 }, uFocus: { value: new THREE.Vector3() }, uFocusOn: { value: 0 } };

/** The point the camera is looking at; plants between the camera and it fade out with a dither. */
export function setFocus(p: THREE.Vector3 | null) {
  swayUniforms.uFocusOn.value = p ? 1 : 0;
  if (p) swayUniforms.uFocus.value.copy(p);
}

/** Gentle wind: bends vertices sideways by height above the model's base. */
function addSway(material: THREE.Material, strength: number): THREE.Material {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swayUniforms.uTime;
    shader.uniforms.uFocus = swayUniforms.uFocus;
    shader.uniforms.uFocusOn = swayUniforms.uFocusOn;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFocus;\nuniform float uFocusOn;\nvarying vec3 vSwayWorld;")
      .replace(
        "#include <clipping_planes_fragment>",
        /* glsl */ `#include <clipping_planes_fragment>
        if (uFocusOn > 0.5) {
          vec3 seg = uFocus - cameraPosition;
          float segLen = length(seg);
          vec3 segDir = seg / max(segLen, 0.001);
          float tS = dot(vSwayWorld - cameraPosition, segDir);
          float dS = length(vSwayWorld - (cameraPosition + segDir * clamp(tS, 0.0, segLen)));
          float occl = (1.0 - smoothstep(1.0, 2.2, dS)) * step(0.3, tS) * step(tS, segLen - 0.8);
          if (occl > 0.0) {
            vec2 fc = mod(floor(gl_FragCoord.xy), 4.0);
            float bayer = mod(fc.x * 4.0 + fc.y * 9.0 + fc.x * fc.y * 7.0, 16.0) / 16.0;
            if (bayer < occl * 0.9) discard;
          }
        }`,
      );
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vSwayWorld;")
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec4 mvPosition = vec4( transformed, 1.0 );
        vec4 swayOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          swayOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        vec4 swayWorld = modelMatrix * mvPosition;
        float swayH = max(swayWorld.y - swayOrigin.y, 0.0);
        float swayPhase = swayOrigin.x * 0.37 + swayOrigin.z * 0.23;
        float swayAmt = (sin(uTime * 1.3 + swayPhase) * 0.7 + sin(uTime * 2.7 + swayPhase * 1.7) * 0.3) * ${strength.toFixed(4)} * swayH * swayH;
        swayWorld.x += swayAmt;
        swayWorld.z += swayAmt * 0.5;
        vSwayWorld = swayWorld.xyz;
        mvPosition = viewMatrix * swayWorld;
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
  };
  m.customProgramCacheKey = () => `sway-${strength}`;
  return m;
}

function tuneMaterial(m: THREE.Material) {
  if (m instanceof THREE.MeshStandardMaterial) {
    m.roughness = Math.max(m.roughness, 0.85);
    m.metalness = 0;
    m.flatShading = true;
    m.side = THREE.FrontSide;
  }
}

/** Places many copies of a model with one draw call per mesh part. */
function scatter(
  scene: THREE.Scene,
  model: THREE.Object3D,
  mats: THREE.Matrix4[],
  opts: { shadow?: boolean; sway?: number } = {},
): void {
  if (!mats.length) return;
  model.updateMatrixWorld(true);
  const parts: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh);
  });
  for (const part of parts) {
    const base = Array.isArray(part.material) ? part.material[0] : part.material;
    tuneMaterial(base);
    const mat = opts.sway ? addSway(base, opts.sway) : base;
    const inst = new THREE.InstancedMesh(part.geometry, mat, mats.length);
    const tmp = new THREE.Matrix4();
    mats.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, part.matrixWorld)));
    inst.castShadow = !!opts.shadow;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    scene.add(inst);
  }
}

function placeholderTree(): THREE.Object3D {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 2, 6), new THREE.MeshStandardMaterial({ color: "#7a5236" }));
  trunk.position.y = 1;
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({ color: "#5f9e4a", flatShading: true }));
  top.position.y = 2.8;
  g.add(trunk, top);
  return g;
}

function placeholderBox(w: number, h: number, d: number, color: string): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

const matrix = (x: number, y: number, z: number, rotY: number, s: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(s, s, s));

export async function createWorld(scene: THREE.Scene, terrain: Terrain, lanternSpots: THREE.Vector2[]): Promise<World> {
  const names = ["palm", "cherry", "pine", "fir", "bush", "rock", "rock-small", "lighthouse", "cottage", "boat", "pier", "campfire", "flower"] as const;
  const loaded = await Promise.all(names.map((n) => loadModel(`assets/${n}.glb`)));
  const M = Object.fromEntries(names.map((n, i) => [n, loaded[i]])) as Record<(typeof names)[number], THREE.Object3D | null>;

  const colliders: Collider[] = [];
  const decks: Deck[] = [];
  const h = terrain.heightAt;
  const rand = rng(2024);
  const updaters: ((t: number, dusk: number) => void)[] = [];

  // --- Landmarks -----------------------------------------------------------
  const lighthouse = M.lighthouse ?? placeholderBox(3, 13, 3, "#e9e2d6");
  lighthouse.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) tuneMaterial((o as THREE.Mesh).material as THREE.Material);
  });
  const lhY = h(LIGHTHOUSE.x, LIGHTHOUSE.y) - 0.15;
  lighthouse.position.set(LIGHTHOUSE.x, lhY, LIGHTHOUSE.y);
  lighthouse.rotation.y = 0.6;
  lighthouse.traverse((o) => (o.receiveShadow = true));
  scene.add(lighthouse);
  colliders.push({ x: LIGHTHOUSE.x, z: LIGHTHOUSE.y, r: 2.6 });
  const lhBox = new THREE.Box3().setFromObject(lighthouse);
  const lighthouseLamp = new THREE.Vector3(LIGHTHOUSE.x, lhBox.max.y - 2.2, LIGHTHOUSE.y);

  // Lighthouse lamp + slowly turning beam that wakes up as the sun sets.
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd28a").multiplyScalar(4), transparent: true, opacity: 0 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), lampMat);
  lamp.position.copy(lighthouseLamp);
  scene.add(lamp);
  const beamGeo = new THREE.ConeGeometry(3.2, 34, 24, 1, true);
  beamGeo.translate(0, -17, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#ffd9a0") } },
    vertexShader: `varying float vL; void main(){ vL = clamp(position.x / 34.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vL; void main(){ gl_FragColor = vec4(uColor * uOpacity * pow(max(1.0 - vL, 0.0), 1.6), 1.0); }`,
  });
  const beam = new THREE.Group();
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI;
  beam.add(beamA, beamB);
  beam.position.copy(lighthouseLamp);
  scene.add(beam);
  updaters.push((t, dusk) => {
    const on = THREE.MathUtils.smoothstep(dusk, 0.35, 0.8);
    lampMat.opacity = 0.25 + on * 0.75;
    beamMat.uniforms.uOpacity.value = on * 0.22;
    beam.rotation.y = t * 0.45;
  });

  const cottage = M.cottage ?? placeholderBox(6, 4, 4, "#e4d3b4");
  cottage.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) tuneMaterial((o as THREE.Mesh).material as THREE.Material);
    o.receiveShadow = true;
  });
  const cotRot = 0.5;
  cottage.position.set(COTTAGE.x, h(COTTAGE.x, COTTAGE.y) - 0.1, COTTAGE.y);
  cottage.rotation.y = cotRot;
  scene.add(cottage);
  for (const s of [-1.9, 0, 1.9]) {
    colliders.push({ x: COTTAGE.x + Math.cos(cotRot) * s, z: COTTAGE.y - Math.sin(cotRot) * s, r: 2.2 });
  }
  // Warm window glow at dusk.
  const windowGlow = new THREE.PointLight("#ffb46b", 0, 9, 1.6);
  windowGlow.position.set(COTTAGE.x + Math.sin(cotRot) * 2.6, h(COTTAGE.x, COTTAGE.y) + 1.4, COTTAGE.y + Math.cos(cotRot) * 2.6);
  scene.add(windowGlow);

  // Campfire in front of the cottage.
  const fireX = COTTAGE.x - 5.5;
  const fireZ = COTTAGE.y + 5.5;
  const campfire = M.campfire ?? placeholderBox(1, 0.4, 1, "#8a8279");
  campfire.position.set(fireX, h(fireX, fireZ), fireZ);
  campfire.scale.setScalar(1.3);
  campfire.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    tuneMaterial(mesh.material as THREE.Material);
    if (mesh.name.includes("flame")) {
      const fm = (mesh.material as THREE.MeshStandardMaterial).clone();
      fm.emissive = new THREE.Color("#ff8a2a");
      fm.emissiveIntensity = 2.2;
      mesh.material = fm;
      mesh.castShadow = false;
      updaters.push((t) => {
        fm.emissiveIntensity = 1.8 + Math.sin(t * 11) * 0.3 + Math.sin(t * 17.3) * 0.25;
        mesh.scale.y = 1 + Math.sin(t * 9.1) * 0.08;
      });
    }
  });
  scene.add(campfire);
  colliders.push({ x: fireX, z: fireZ, r: 0.9 });
  const fireLight = new THREE.PointLight("#ff9a4a", 0, 12, 1.5);
  fireLight.position.set(fireX, campfire.position.y + 1.2, fireZ);
  scene.add(fireLight);
  updaters.push((t, dusk) => {
    const k = 0.4 + dusk * 1.6;
    fireLight.intensity = (6 + Math.sin(t * 13) * 1.2 + Math.sin(t * 7.7) * 0.8) * k;
    windowGlow.intensity = THREE.MathUtils.smoothstep(dusk, 0.2, 0.9) * 10;
  });

  // --- Pier + boat ----------------------------------------------------------
  // Walk out from the beach to the south-east until the water gets deep.
  const dir = new THREE.Vector2(0.62, 0.78).normalize();
  let start = 20;
  while (start < 60 && h(dir.x * start, dir.y * start) > 0.25) start += 0.25;
  const pierModel = M.pier ?? placeholderBox(4, 1.2, 3, "#a77a4a");
  // Measure the deck height by casting a ray down on the model.
  pierModel.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let deckLocal = 0;
  for (const [px, pz] of [[0, 0], [0.4, 0.3], [-0.6, -0.2], [0.9, -0.5], [-0.3, 0.6]]) {
    ray.set(new THREE.Vector3(px, 10, pz), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(pierModel, true)[0];
    if (hit && hit.point.y < 1.45) deckLocal = Math.max(deckLocal, hit.point.y);
  }
  if (!deckLocal) deckLocal = 1.2;
  const pierBase = 0.85 - deckLocal; // deck sits ~0.85 m above the sea
  const pierAngle = Math.atan2(dir.x, dir.y);
  const sections = 4;
  const secLen = 4;
  const pierMats: THREE.Matrix4[] = [];
  for (let i = 0; i < sections; i++) {
    const d = start - 3 + i * secLen;
    // the model's long side is X, so turn it to run along the pier direction
    pierMats.push(matrix(dir.x * d, pierBase, dir.y * d, pierAngle + Math.PI / 2, 1));
  }
  scatter(scene, pierModel, pierMats, { shadow: true });
  const pierMid = start - 3 + ((sections - 1) * secLen) / 2;
  decks.push({ cx: dir.x * pierMid, cz: dir.y * pierMid, hx: 1.25, hz: (sections * secLen) / 2, rot: pierAngle, y: 0.85 });
  const endD = start - 3 + (sections - 1) * secLen + 1;
  const pierEnd = new THREE.Vector3(dir.x * endD, 0.85, dir.y * endD);
  const pierStart = new THREE.Vector3(dir.x * (start - 6), 0, dir.y * (start - 6));

  const boat = M.boat ?? placeholderBox(1.2, 0.6, 3.2, "#9b6b43");
  boat.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) tuneMaterial((o as THREE.Mesh).material as THREE.Material);
  });
  const side = new THREE.Vector2(dir.y, -dir.x);
  const bd = start + 6;
  boat.position.set(dir.x * bd + side.x * 2.6, -0.25, dir.y * bd + side.y * 2.6);
  boat.rotation.y = pierAngle + 0.15;
  scene.add(boat);
  updaters.push((t) => {
    boat.position.y = -0.28 + Math.sin(t * 1.3) * 0.06;
    boat.rotation.z = Math.sin(t * 1.1) * 0.04;
    boat.rotation.x = Math.sin(t * 0.8 + 1) * 0.025;
  });

  // --- Scatter nature -------------------------------------------------------
  const pierClear = (x: number, z: number) => {
    const along = x * dir.x + z * dir.y;
    const across = Math.abs(x * dir.y - z * dir.x);
    return !(along > start - 8 && across < 4);
  };
  const free = (x: number, z: number, minDist: number) => {
    if (Math.hypot(x - COTTAGE.x, z - COTTAGE.y) < 8) return false;
    if (Math.hypot(x - fireX, z - fireZ) < 3.5) return false;
    if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.y) < 7) return false;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.y) < 5) return false;
    if (distToPath(x, z) < 2.4) return false;
    if (!pierClear(x, z)) return false;
    for (const s of lanternSpots) if (Math.hypot(x - s.x, z - s.y) < 3) return false;
    for (const c of colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + minDist) return false;
    return true;
  };
  const scatterKind = (
    model: THREE.Object3D | null,
    count: number,
    hMin: number,
    hMax: number,
    sMin: number,
    sMax: number,
    collR: number,
    opts: { shadow?: boolean; sway?: number; spacing?: number; sink?: number },
  ) => {
    const mats: THREE.Matrix4[] = [];
    let tries = 0;
    while (mats.length < count && tries++ < count * 60) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 46;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = h(x, z);
      if (y < hMin || y > hMax) continue;
      // keep off steep slopes
      const slope = Math.abs(h(x + 0.8, z) - y) + Math.abs(h(x, z + 0.8) - y);
      if (slope > 0.9) continue;
      if (!free(x, z, opts.spacing ?? 1)) continue;
      const s = sMin + rand() * (sMax - sMin);
      mats.push(matrix(x, y - (opts.sink ?? 0.05), z, rand() * Math.PI * 2, s));
      if (collR > 0) colliders.push({ x, z, r: collR * s });
    }
    scatter(scene, model ?? placeholderTree(), mats, opts);
  };

  scatterKind(M.palm, 16, 0.45, 1.8, 0.8, 1.15, 0.35, { shadow: true, sway: 0.0045, spacing: 2.5 });
  scatterKind(M.cherry, 9, 1.6, 6, 0.8, 1.1, 0.45, { shadow: true, sway: 0.0025, spacing: 3.5 });
  scatterKind(M.pine, 12, 1.3, 6.5, 1.2, 1.7, 0.4, { shadow: true, sway: 0.004, spacing: 2.5 });
  scatterKind(M.fir, 14, 2.5, 9, 0.55, 0.85, 0.35, { shadow: true, sway: 0.0012, spacing: 2 });
  scatterKind(M.bush, 40, 0.9, 8, 0.9, 1.6, 0, { shadow: false, sway: 0.02, spacing: 0.6 });
  scatterKind(M.rock, 14, 0.6, 9, 1.2, 2.4, 0.5, { shadow: true, spacing: 1.2, sink: 0.25 });
  scatterKind(M["rock-small"], 30, 0.3, 9, 0.8, 1.8, 0, { shadow: false, spacing: 0.4, sink: 0.1 });
  scatterKind(M.flower, 180, 1.0, 7, 1.4, 2.2, 0, { shadow: false, sway: 0.25, spacing: 0 });

  // Sea rocks around the coast for a nicer silhouette.
  {
    const mats: THREE.Matrix4[] = [];
    let tries = 0;
    while (mats.length < 16 && tries++ < 2000) {
      const a = rand() * Math.PI * 2;
      const r = 30 + rand() * 22;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = h(x, z);
      if (y > 0.2 || y < -3) continue;
      if (!pierClear(x, z)) continue;
      const s = 1.6 + rand() * 2.6;
      mats.push(matrix(x, y - 0.3, z, rand() * 6.28, s));
      colliders.push({ x, z, r: 0.45 * s });
    }
    scatter(scene, M.rock ?? placeholderBox(1, 0.8, 1, "#888"), mats, { shadow: true });
  }

  const insideDeck = (d: Deck, x: number, z: number) => {
    const dx = x - d.cx;
    const dz = z - d.cz;
    const c = Math.cos(d.rot);
    const s = Math.sin(d.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) <= d.hx && Math.abs(lz) <= d.hz;
  };

  return {
    colliders,
    decks,
    pierEnd,
    pierStart,
    lighthouseLamp,
    groundAt(x, z) {
      let g = h(x, z);
      for (const d of decks) if (insideDeck(d, x, z)) g = Math.max(g, d.y);
      return g;
    },
    update(time, dusk) {
      swayUniforms.uTime.value = time;
      for (const u of updaters) u(time, dusk);
    },
  };
}
