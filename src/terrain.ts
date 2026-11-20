import * as THREE from "three";
import { clamp, fbm, lerp, noise2, rng, smoothstep } from "./noise";

/** The island: a flat-shaded low-poly heightfield centred on the origin. Water is at y = 0. */
export const SIZE = 160;
const SEG = 160;
const CELL = SIZE / SEG;
const HALF = SIZE / 2;

export const LIGHTHOUSE = new THREE.Vector2(-21, -19);
export const COTTAGE = new THREE.Vector2(13, -7);
export const SPAWN = new THREE.Vector2(3, 24);

/** A winding dirt path: beach → cottage → hill → lighthouse. */
export const PATH: THREE.Vector2[] = [
  new THREE.Vector2(4, 31),
  new THREE.Vector2(3, 22),
  new THREE.Vector2(8, 12),
  new THREE.Vector2(12, 1),
  new THREE.Vector2(6, -9),
  new THREE.Vector2(-4, -12),
  new THREE.Vector2(-12, -14),
  new THREE.Vector2(-17, -16),
];

function distToSegment(px: number, pz: number, a: THREE.Vector2, b: THREE.Vector2): number {
  const abx = b.x - a.x;
  const abz = b.y - a.y;
  const t = clamp(((px - a.x) * abx + (pz - a.y) * abz) / (abx * abx + abz * abz), 0, 1);
  const dx = px - (a.x + abx * t);
  const dz = pz - (a.y + abz * t);
  return Math.hypot(dx, dz);
}

export function distToPath(x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) d = Math.min(d, distToSegment(x, z, PATH[i], PATH[i + 1]));
  return d;
}

/** How much a point belongs to the island (1 inland, 0 open sea). */
function landMask(x: number, z: number): number {
  const r = Math.hypot(x, z) + fbm(x * 0.03 + 4.2, z * 0.03 - 1.3, 3) * 10;
  return 1 - smoothstep(24, 44, r);
}

/** The smooth height before it is sampled into the low-poly grid. */
export function rawHeight(x: number, z: number): number {
  const s = landMask(x, z);
  let land = 1.7 + fbm(x * 0.055, z * 0.055, 4) * 1.7 + Math.max(0, noise2(x * 0.11 + 9, z * 0.11)) * 0.6;
  // The lighthouse hill rises towards the north-west cliffs.
  const dl = Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.y);
  land += 7.2 * Math.exp(-(dl * dl) / (2 * 8.5 * 8.5));
  // A gentle second hill in the east.
  const de = Math.hypot(x - 24, z - 6);
  land += 2.4 * Math.exp(-(de * de) / (2 * 6 * 6));
  // Flat meadow for the cottage and a flat top for the lighthouse.
  const dc = Math.hypot(x - COTTAGE.x, z - COTTAGE.y);
  land = lerp(land, 2.1, 1 - smoothstep(6, 11, dc));
  land = lerp(land, 8.6, 1 - smoothstep(3.5, 6, dl));
  // Dirt path is slightly sunken and smoothed.
  const dp = distToPath(x, z);
  land -= (1 - smoothstep(0.5, 2.2, dp)) * 0.18;

  if (s > 0.5) return lerp(0.35, land, smoothstep(0.55, 0.95, s));
  return lerp(-7, 0.35, smoothstep(0.0, 0.5, s) ** 0.7);
}

export interface Terrain {
  mesh: THREE.Mesh;
  heightAt(x: number, z: number): number;
  heightTexture: THREE.DataTexture;
}

export function createTerrain(): Terrain {
  const n = SEG + 1;
  const h = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ix * CELL - HALF;
      const z = iz * CELL - HALF;
      // A little jitter in height gives the hand-made low-poly feel.
      h[iz * n + ix] = rawHeight(x, z) + noise2(x * 0.9, z * 0.9) * 0.08;
    }
  }

  const heightAt = (x: number, z: number): number => {
    const gx = (x + HALF) / CELL;
    const gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -7;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = h[iz * n + ix];
    const h10 = h[iz * n + ix + 1];
    const h01 = h[(iz + 1) * n + ix];
    const h11 = h[(iz + 1) * n + ix + 1];
    if (fx > fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  };

  // Build non-indexed triangles so each face gets its own flat colour.
  const tris = SEG * SEG * 2;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  const sand = new THREE.Color("#ecc98d");
  const wetSand = new THREE.Color("#c9a66e");
  const grassA = new THREE.Color("#8fc958");
  const grassB = new THREE.Color("#6aaa45");
  const grassHigh = new THREE.Color("#a4c464");
  const rock = new THREE.Color("#a08d7a");
  const rockDark = new THREE.Color("#7d6e62");
  const dirt = new THREE.Color("#c99b62");
  const seabed = new THREE.Color("#d8c08e");
  const c = new THREE.Color();
  const r = rng(7);
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let p = 0;

  const face = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    va.set(ax * CELL - HALF, h[az * n + ax], az * CELL - HALF);
    vb.set(bx * CELL - HALF, h[bz * n + bx], bz * CELL - HALF);
    vc.set(cx * CELL - HALF, h[cz * n + cx], cz * CELL - HALF);
    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    const my = (va.y + vb.y + vc.y) / 3;
    const mx = (va.x + vb.x + vc.x) / 3;
    const mz = (va.z + vb.z + vc.z) / 3;
    const k = noise2(mx * 0.12, mz * 0.12) * 0.5 + 0.5;

    if (my < -0.2) c.copy(seabed).lerp(wetSand, 0.3);
    else if (my < 0.55) c.copy(wetSand).lerp(sand, smoothstep(-0.2, 0.55, my));
    else if (my < 0.95 + k * 0.4) c.copy(sand);
    else {
      c.copy(grassB).lerp(grassA, k);
      c.lerp(grassHigh, smoothstep(5, 9, my) * 0.6);
      const dp = distToPath(mx, mz);
      if (dp < 1.3 + k * 0.6) c.copy(dirt).lerp(sand, k * 0.3);
    }
    if (ny < 0.72 && my > 0.3) c.copy(rock).lerp(rockDark, k);
    else if (ny < 0.82 && my > 0.6) c.lerp(rock, 0.5);
    // Per-face shade jitter.
    const j = 0.94 + r() * 0.1;
    c.multiplyScalar(j);

    for (const v of [va, vb, vc]) {
      pos[p] = v.x;
      pos[p + 1] = v.y;
      pos[p + 2] = v.z;
      col[p] = c.r;
      col[p + 1] = c.g;
      col[p + 2] = c.b;
      p += 3;
    }
  };

  for (let iz = 0; iz < SEG; iz++) {
    for (let ix = 0; ix < SEG; ix++) {
      // Triangulation must match heightAt(): diagonal from (0,0) to (1,1).
      face(ix, iz, ix + 1, iz + 1, ix + 1, iz);
      face(ix, iz, ix, iz + 1, ix + 1, iz + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";

  // Height texture for the water shader (shore foam and depth colour).
  const tn = 256;
  const data = new Uint8Array(tn * tn);
  for (let iz = 0; iz < tn; iz++) {
    for (let ix = 0; ix < tn; ix++) {
      const x = (ix / (tn - 1)) * SIZE - HALF;
      const z = (iz / (tn - 1)) * SIZE - HALF;
      data[iz * tn + ix] = Math.round(clamp((heightAt(x, z) + 8) / 16, 0, 1) * 255);
    }
  }
  const heightTexture = new THREE.DataTexture(data, tn, tn, THREE.RedFormat, THREE.UnsignedByteType);
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.wrapS = heightTexture.wrapT = THREE.ClampToEdgeWrapping;
  heightTexture.needsUpdate = true;

  return { mesh, heightAt, heightTexture };
}
