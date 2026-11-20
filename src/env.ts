import * as THREE from "three";
import { lerp } from "./noise";
import { SIZE } from "./terrain";

/** Sky dome, ocean and the colours of the setting sun. `dusk` goes 0 (golden hour) → 1 (after sunset). */

const KEYS = [
  { t: 0.0, zenith: "#3f68b8", horizon: "#ffa864", sun: "#ffd39c", sunEl: 12, light: 2.8, hemiSky: "#ffd9b5", hemiGround: "#6f8a4a", hemi: 1.25 },
  { t: 0.5, zenith: "#33408c", horizon: "#ff7e4f", sun: "#ffa264", sunEl: 5, light: 2.3, hemiSky: "#ffc0a0", hemiGround: "#647a48", hemi: 1.1 },
  { t: 1.0, zenith: "#181c4a", horizon: "#c45877", sun: "#ff6a50", sunEl: -2, light: 0.5, hemiSky: "#8a86cc", hemiGround: "#33433a", hemi: 0.55 },
];

export interface SkyState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sunDir: THREE.Vector3;
  light: number;
  hemi: number;
}

const SUN_AZIMUTH = -2.35; // the sun sets over the sea, behind the lighthouse side

export function skyAt(dusk: number, out?: SkyState): SkyState {
  const s = out ?? {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sun: new THREE.Color(),
    fog: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sunDir: new THREE.Vector3(),
    light: 0,
    hemi: 0,
  };
  const d = Math.min(Math.max(dusk, 0), 1);
  const i = d < 0.5 ? 0 : 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (d - a.t) / (b.t - a.t);
  s.zenith.set(a.zenith).lerp(new THREE.Color(b.zenith), t);
  s.horizon.set(a.horizon).lerp(new THREE.Color(b.horizon), t);
  s.sun.set(a.sun).lerp(new THREE.Color(b.sun), t);
  s.hemiSky.set(a.hemiSky).lerp(new THREE.Color(b.hemiSky), t);
  s.hemiGround.set(a.hemiGround).lerp(new THREE.Color(b.hemiGround), t);
  s.fog.copy(s.horizon).lerp(s.zenith, 0.12);
  const el = THREE.MathUtils.degToRad(lerp(a.sunEl, b.sunEl, t));
  s.sunDir.set(Math.cos(el) * Math.sin(SUN_AZIMUTH), Math.sin(el), Math.cos(el) * Math.cos(SUN_AZIMUTH));
  s.light = lerp(a.light, b.light, t);
  s.hemi = lerp(a.hemi, b.hemi, t);
  return s;
}

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}
`;

export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uDusk: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir;
      uniform float uTime; uniform float uDusk;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 dir = normalize(vDir);
        float e = dir.y;
        float up = clamp(e, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
        // warm band hugging the horizon on the sun side
        float sd = max(dot(dir, uSunDir), 0.0);
        col += uSun * pow(sd, 8.0) * 0.35 * (1.0 - up);
        col += uSun * pow(sd, 90.0) * 0.5;
        // the sun disc
        col += uSun * smoothstep(0.99955, 0.9998, sd) * 2.2;
        // soft clouds near the horizon, lit from the sun side
        vec2 cp = dir.xz / max(e + 0.18, 0.06) * 1.4;
        float cl = fbm3(cp * vec2(1.0, 2.6) + vec2(uTime * 0.004, 0.0));
        float band = smoothstep(0.02, 0.12, e) * (1.0 - smoothstep(0.25, 0.5, e));
        float cloud = smoothstep(0.5, 0.78, cl) * band;
        vec3 cloudCol = mix(uZenith * 1.1 + vec3(0.05), uSun * 1.25, pow(sd, 2.0) * 0.8 + 0.2);
        col = mix(col, cloudCol, cloud * 0.75);
        // stars come out after sunset
        vec2 sp = floor(dir.xz / max(dir.y + 1.0, 0.2) * 220.0);
        float star = step(0.9965, hash12(sp)) * smoothstep(0.15, 0.6, e) * smoothstep(0.55, 1.0, uDusk);
        col += vec3(star) * (0.6 + 0.4 * sin(uTime * 3.0 + hash12(sp + 3.0) * 30.0));
        // below the horizon: blend into fog colour
        col = mix(col, uHorizon, smoothstep(0.0, -0.08, e));
        gl_FragColor = vec4(clamp(col, 0.0, 16.0), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

export function createWater(heightTexture: THREE.Texture): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geo = new THREE.PlaneGeometry(900, 900, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: heightTexture },
      uSize: { value: SIZE },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 60 },
      uFogFar: { value: 300 },
      uShallow: { value: new THREE.Color("#57d1c2") },
      uDeep: { value: new THREE.Color("#1f5f8f") },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vViewDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float d = length(w.xz);
        float amp = 0.07 + 0.05 * smoothstep(40.0, 90.0, d);
        w.y += sin(w.x * 0.18 + uTime * 1.1) * amp + cos(w.z * 0.22 + uTime * 0.9) * amp;
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vViewDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uHeight; uniform float uSize;
      uniform vec3 uSunDir; uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith;
      uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      uniform vec3 uShallow; uniform vec3 uDeep;
      varying vec3 vWorld;
      varying float vViewDepth;
      ${NOISE_GLSL}
      void main() {
        vec2 uv = vWorld.xz / uSize + 0.5;
        float ground = -7.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ground = texture2D(uHeight, uv).r * 16.0 - 8.0;
        float depth = max(0.0 - ground, 0.0);

        // ripple normal from two scrolling noise layers
        vec2 p = vWorld.xz;
        float n1 = vnoise(p * 0.35 + vec2(uTime * 0.25, uTime * 0.1));
        float n2 = vnoise(p * 0.9 - vec2(uTime * 0.18, uTime * 0.3));
        float nx = (vnoise(p * 0.35 + vec2(0.3, 0.0) + vec2(uTime * 0.25, uTime * 0.1)) - n1) + (vnoise(p * 0.9 + vec2(0.3, 0.0) - vec2(uTime * 0.18, uTime * 0.3)) - n2) * 0.5;
        float nz = (vnoise(p * 0.35 + vec2(0.0, 0.3) + vec2(uTime * 0.25, uTime * 0.1)) - n1) + (vnoise(p * 0.9 + vec2(0.0, 0.3) - vec2(uTime * 0.18, uTime * 0.3)) - n2) * 0.5;
        vec3 N = normalize(vec3(-nx * 1.6, 1.0, -nz * 1.6));

        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 base = mix(uShallow, uDeep, smoothstep(0.2, 5.5, depth));
        base *= mix(vec3(1.0), uSun, 0.35);
        vec3 refl = mix(uHorizon, uZenith, 0.25);
        vec3 col = mix(base, refl, clamp(fres * 0.85 + 0.12, 0.0, 1.0));

        // sun glitter
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 220.0);
        col += uSun * spec * 1.8 * smoothstep(-0.05, 0.08, uSunDir.y);
        col += uSun * pow(max(dot(N, H), 0.0), 18.0) * 0.12;

        // shore foam: soft rings that roll in
        float fn = vnoise(p * 1.4 + uTime * 0.3);
        float wave = sin(depth * 9.0 - uTime * 1.6 + fn * 2.0) * 0.5 + 0.5;
        float foam = (1.0 - smoothstep(0.0, 0.32, depth + fn * 0.12)) + smoothstep(0.75, 1.0, wave) * (1.0 - smoothstep(0.15, 0.9, depth)) * 0.7;
        col = mix(col, vec3(1.0, 0.97, 0.92) * (0.75 + 0.35 * uSun), clamp(foam, 0.0, 1.0) * 0.85);

        float fogF = smoothstep(uFogNear, uFogFar, vViewDepth);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(clamp(col, 0.0, 16.0), 1.0);
      }
    `,
  });
  const water = new THREE.Mesh(geo, mat);
  water.name = "water";
  return water;
}
