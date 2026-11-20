import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Sound } from "./audio";
import { LANTERN_COLORS, Lantern, createBirds, createBursts, createFireflies } from "./effects";
import { createSky, createWater, skyAt } from "./env";
import { createInput } from "./input";
import { clamp, lerp, rng } from "./noise";
import { Player } from "./player";
import { COTTAGE, LIGHTHOUSE, SPAWN, createTerrain } from "./terrain";
import { createWorld, setFocus } from "./world";

// ---------------------------------------------------------------------------
// Settings
const DURATION = 90; // seconds until the sun sets
const params = new URLSearchParams(location.search);
const ATTRACT = params.has("attract") && params.get("attract") !== "0";
const LOCK_QUALITY = params.has("hq");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (ATTRACT) document.body.classList.add("attract");

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
let pixelRatio = Math.min(devicePixelRatio, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog("#f6c79a", 95, 420);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);

const hemi = new THREE.HemisphereLight("#ffe6c8", "#6a8a45", 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffdcaa", 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -55;
sc.right = 55;
sc.top = 55;
sc.bottom = -55;
sc.near = 1;
sc.far = 260;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2;
scene.add(sun, sun.target);

const terrain = createTerrain();
scene.add(terrain.mesh);
const water = createWater(terrain.heightTexture);
scene.add(water);
const sky = createSky();
scene.add(sky);

// ---------------------------------------------------------------------------
// Post-processing: gentle bloom so the lanterns and the sun glow.
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Lantern spots: spread around the island so a walk visits every corner.
const terrainH = terrain.heightAt;
function onLand(x: number, z: number, min = 0.6): THREE.Vector2 {
  const v = new THREE.Vector2(x, z);
  for (let i = 0; i < 80 && terrainH(v.x, v.y) < min; i++) v.multiplyScalar(0.97);
  return v;
}
const spotsRaw: [number, number][] = [
  [6, 15], // first one, right on the path
  [COTTAGE.x - 9, COTTAGE.y + 2], // by the campfire
  [COTTAGE.x + 4, COTTAGE.y - 8], // behind the cottage
  [LIGHTHOUSE.x + 4.5, LIGHTHOUSE.y + 3.5], // lighthouse hill top
  [25, 6], // east hill
  [-36, 4], // west beach
  [-2, -36], // north beach
  [-15, 17], // south-west meadow
  [-6, -1], // island centre
  [35, -14], // east beach
  [-26, 27], // palm beach
];
const lanternSpots: THREE.Vector2[] = spotsRaw.map(([x, z]) => onLand(x, z));
// The 12th spot is the end of the pier; it is filled in once the world knows where the pier is.
const pierSpot = new THREE.Vector2(0, 0);
lanternSpots.push(pierSpot);

// ---------------------------------------------------------------------------
// Game state
type State = "loading" | "title" | "playing" | "paused" | "ended";
let state: State = "loading";
let elapsed = 0;
let collected = 0;
let won = false;
let endTimer = 0;
let lastTickSecond = -1;
let hintTimer = 0;
const sound = new Sound();
const player = new Player(scene);
const lanterns: Lantern[] = [];
const decoLanterns: Lantern[] = [];
const fireflies = createFireflies(scene, terrainH);
const bursts = createBursts(scene);
const birds = createBirds(scene);
const wind = new THREE.Vector3(-0.5, 0, -0.35);
let world: Awaited<ReturnType<typeof createWorld>> | null = null;

const input = createInput(renderer.domElement, $("stick"), $("knob"), $("jump"));

// Camera rig
let camYaw = 0;
let camPitch = 0.42;
let camDist = 8;
let lastManualLook = -10;
let orbitAngle = Number(params.get("to") ?? 1.9);
let viewShift = 0;
let camBlend = 1; // grows to 1 after a camera cut, for a smooth glide
let firstFrame = true;
const camPos = new THREE.Vector3(60, 30, 60);
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();

const TITLE_DUSK = Number(params.get("td") ?? 0.3);
const TITLE_R = Number(params.get("tr") ?? 1);
const TITLE_H = Number(params.get("th") ?? 21);
const TITLE_LOOK = Number(params.get("tl") ?? 2.5);
const skyState = skyAt(TITLE_DUSK);

function applyDusk(dusk: number) {
  skyAt(dusk, skyState);
  const u = sky.material.uniforms;
  u.uZenith.value.copy(skyState.zenith);
  u.uHorizon.value.copy(skyState.horizon);
  u.uSun.value.copy(skyState.sun);
  u.uSunDir.value.copy(skyState.sunDir);
  u.uDusk.value = dusk;
  const w = water.material.uniforms;
  w.uSunDir.value.copy(skyState.sunDir);
  w.uSun.value.copy(skyState.sun);
  w.uHorizon.value.copy(skyState.horizon);
  w.uZenith.value.copy(skyState.zenith);
  w.uFogColor.value.copy(skyState.fog);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(skyState.fog);
  w.uFogNear.value = fog.near;
  w.uFogFar.value = fog.far;
  sun.color.copy(skyState.sun);
  sun.intensity = skyState.light;
  hemi.color.copy(skyState.hemiSky);
  hemi.groundColor.copy(skyState.hemiGround);
  hemi.intensity = skyState.hemi;
  // keep the light a little above the horizon so shadows never flip under the island
  tmpV.copy(skyState.sunDir);
  tmpV.y = Math.max(tmpV.y, 0.12);
  sun.position.copy(tmpV.normalize().multiplyScalar(120));
  sun.target.position.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// UI
const ui = {
  title: $("title"),
  start: $<HTMLButtonElement>("start"),
  best: $("best"),
  hud: $("hud"),
  got: $("got"),
  count: $("count"),
  time: $("time"),
  sun: $("sun"),
  fill: $("fill"),
  guide: $("guide"),
  guideDist: document.querySelector<HTMLElement>("#guide .dist")!,
  toast: $("toast"),
  hint: $("hint"),
  end: $("end"),
  endTitle: $("end-title"),
  endSub: $("end-sub"),
  endLamps: $("end-lamps"),
  stGot: $("st-got"),
  stTime: $("st-time"),
  stScore: $("st-score"),
  newbest: $("newbest"),
  pause: $("pause"),
  mute: $("mute"),
  credits: $("credits"),
};

const BEST_KEY = "noeul-fox-best";
function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* private mode: just skip */
  }
}
function showBest() {
  const b = readBest();
  ui.best.textContent = b > 0 ? `최고 기록 ${b.toLocaleString("ko-KR")}점` : "";
}
showBest();

const fmt = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

let toastTimer = 0;
function toast(text: string) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  toastTimer = 1.8;
}

function show(el: HTMLElement, on: boolean) {
  if (on) {
    el.classList.remove("hidden");
    requestAnimationFrame(() => el.classList.remove("fade"));
  } else {
    el.classList.add("hidden");
  }
}

$("credits-btn").addEventListener("click", () => ui.credits.classList.toggle("hidden"));
ui.mute.addEventListener("click", () => {
  sound.setMuted(!sound.muted);
  ui.mute.setAttribute("aria-label", sound.muted ? "소리 켜기" : "소리 끄기");
  ($("wave") as unknown as SVGPathElement).style.display = sound.muted ? "none" : "";
});
$("pause-btn").addEventListener("click", () => setPaused(true));
$("resume").addEventListener("click", () => setPaused(false));
$("quit").addEventListener("click", () => toTitle());
$("again").addEventListener("click", () => startGame());
$("home").addEventListener("click", () => toTitle());
ui.start.addEventListener("click", () => startGame());

addEventListener("keydown", (e) => {
  if (e.code === "Enter" && !e.repeat) {
    if (state === "title" && !ui.start.disabled) startGame();
    else if (state === "ended" && endTimer > 1.2) startGame();
  }
  if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) {
    if (state === "playing") setPaused(true);
    else if (state === "paused") setPaused(false);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") setPaused(true);
});

function setPaused(p: boolean) {
  if (p && state === "playing") {
    state = "paused";
    input.setEnabled(false);
    show(ui.pause, true);
  } else if (!p && state === "paused") {
    state = "playing";
    input.setEnabled(true);
    show(ui.pause, false);
  }
}

// ---------------------------------------------------------------------------
// Flow
function resetLanterns() {
  for (const l of lanterns) l.reset();
}

function startGame() {
  if (!world) return;
  sound.start();
  state = "playing";
  elapsed = 0;
  collected = 0;
  won = false;
  lastTickSecond = -1;
  hintTimer = 7;
  resetLanterns();
  const y = world.groundAt(SPAWN.x, SPAWN.y);
  player.reset(SPAWN.x, y, SPAWN.y, Math.PI);
  camYaw = 0;
  camPitch = 0.42;
  camDist = 8;
  camBlend = 0.04;
  ui.got.textContent = "0";
  ui.sun.classList.remove("late");
  ui.title.classList.add("fade");
  setTimeout(() => state === "playing" && ui.title.classList.add("hidden"), 600);
  show(ui.end, false);
  ui.end.classList.add("fade");
  show(ui.pause, false);
  ui.credits.classList.add("hidden");
  $("credits-btn").classList.add("hidden");
  ui.hud.classList.remove("hidden");
  ui.hint.style.opacity = "1";
  input.setEnabled(true);
}

function toTitle() {
  state = "title";
  input.setEnabled(false);
  resetLanterns();
  ui.hud.classList.add("hidden");
  show(ui.end, false);
  show(ui.pause, false);
  ui.title.classList.remove("hidden");
  requestAnimationFrame(() => ui.title.classList.remove("fade"));
  $("credits-btn").classList.remove("hidden");
  camBlend = 0.03;
  showBest();
  const y = world ? world.groundAt(SPAWN.x, SPAWN.y) : 0;
  player.reset(SPAWN.x, y, SPAWN.y, Math.PI);
}

function finish(win: boolean) {
  state = "ended";
  won = win;
  endTimer = 0;
  input.setEnabled(false);
  ui.guide.style.opacity = "0";
  const left = Math.max(0, DURATION - elapsed);
  const score = collected * 100 + (win ? Math.ceil(left) * 10 : 0);
  const stars = win ? (left >= 40 ? 3 : 2) : collected >= 6 ? 1 : 0;
  const prev = readBest();
  const isBest = score > prev;
  if (isBest) writeBest(score);
  ui.endTitle.textContent = win ? "모든 등불이 하늘로 올랐어요" : "해가 바다 너머로 졌어요";
  ui.endSub.textContent = win
    ? `해가 지기 ${fmt(left)} 전에 섬을 모두 밝혔어요. 여우가 뿌듯해해요.`
    : `등불 ${collected}개가 밤하늘을 밝히고 있어요. 다음엔 조금 더 서둘러 볼까요?`;
  ui.stGot.textContent = `${collected}/12`;
  ui.stTime.textContent = win ? fmt(left) : "0:00";
  orbitAngle = Math.atan2(camera.position.x, camera.position.z);
  camBlend = 0;
  ui.stScore.textContent = score.toLocaleString("ko-KR");
  ui.endLamps.innerHTML = [0, 1, 2].map((i) => `<span class="lamp${i < stars ? "" : " off"}"></span>`).join("");
  ui.newbest.classList.toggle("hidden", !isBest);
  if (win) {
    sound.win();
    // Any lantern still floating rises with the rest (there are none when you win, but just in case).
    for (const l of lanterns) l.collect(wind);
  } else sound.lose();
  setTimeout(() => {
    if (state !== "ended") return;
    ui.hud.classList.add("hidden");
    show(ui.end, true);
  }, 1700);
}

function collect(l: Lantern) {
  l.collect(wind);
  collected++;
  bursts.spawn(l.hover, reduceMotion ? 14 : 40);
  sound.collect(collected - 1);
  ui.got.textContent = String(collected);
  ui.count.classList.remove("bump");
  void ui.count.offsetWidth;
  ui.count.classList.add("bump");
  if (!reduceMotion) fovKick = 1;
  const left = lanterns.length - collected;
  if (left === 0) finish(true);
  else toast(left === 1 ? "마지막 하나 남았어요!" : `등불이 떠올라요 · ${left}개 남았어요`);
}
let fovKick = 0;

// ---------------------------------------------------------------------------
// Loading
async function init() {
  const w = await createWorld(scene, terrain, lanternSpots);
  world = w;
  pierSpot.set(w.pierEnd.x, w.pierEnd.z);
  await player.load();
  const r = rng(31);
  lanternSpots.forEach((s, i) => {
    const gy = s === pierSpot ? w.pierEnd.y : w.groundAt(s.x, s.y);
    lanterns.push(new Lantern(scene, new THREE.Vector3(s.x, gy, s.y), LANTERN_COLORS[i % LANTERN_COLORS.length], r() * 10, true));
  });
  // Lanterns already drifting over the sea, from earlier evenings.
  for (let i = 0; i < 16; i++) {
    const a = -2.35 + (r() - 0.5) * 2.2;
    const d = 40 + r() * 70;
    const l = new Lantern(scene, new THREE.Vector3(), LANTERN_COLORS[i % 4], r() * 10, false);
    l.setSky(new THREE.Vector3(Math.sin(a) * d, 14 + r() * 26, Math.cos(a) * d), new THREE.Vector3(-0.3 - r() * 0.3, 0, -0.2));
    decoLanterns.push(l);
  }
  const y = w.groundAt(SPAWN.x, SPAWN.y);
  player.reset(SPAWN.x, y, SPAWN.y, Math.PI);

  // Compile shaders before the first visible frame to avoid a hitch.
  await renderer.compileAsync(scene, camera);
  ui.start.disabled = false;
  ui.start.innerHTML = "산책 시작하기 <kbd>Enter</kbd>";
  state = "title";
  if (ATTRACT) document.title = "노을여우";
}
init().catch((err) => {
  console.error(err);
  ui.start.textContent = "불러오지 못했어요. 새로고침해 주세요.";
});

// ---------------------------------------------------------------------------
// Resize + adaptive quality
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  bloom.setSize(w / 2, h / 2);
}
addEventListener("resize", resize);

let quality = 0;
let frameAcc = 0;
let frameCount = 0;
let qualityWait = 4;
function adaptQuality(dt: number) {
  if (LOCK_QUALITY) return;
  if (qualityWait > 0) {
    qualityWait -= dt;
    return;
  }
  frameAcc += dt;
  frameCount++;
  if (frameAcc < 2) return;
  const avg = frameAcc / frameCount;
  frameAcc = 0;
  frameCount = 0;
  if (avg > 1 / 48 && quality < 3) {
    quality++;
    if (quality === 1) pixelRatio = Math.min(pixelRatio, 1.25);
    if (quality === 2) {
      pixelRatio = 1;
      bloom.enabled = false;
    }
    if (quality === 3) {
      pixelRatio = 0.8;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    resize();
    qualityWait = 2;
  }
}

// ---------------------------------------------------------------------------
// Main loop
const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
let dusk = TITLE_DUSK;
const lookTarget = new THREE.Vector3();

function nearestLantern(): Lantern | null {
  let best: Lantern | null = null;
  let bd = Infinity;
  for (const l of lanterns) {
    if (l.state !== "idle") continue;
    const d = l.hover.distanceToSquared(player.position);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

function updateGuide() {
  const l = state === "playing" ? nearestLantern() : null;
  if (!l) {
    ui.guide.style.opacity = "0";
    return;
  }
  const dist = Math.hypot(l.hover.x - player.position.x, l.hover.z - player.position.z);
  tmpV.copy(l.hover).project(camera);
  const behind = tmpV.z > 1;
  let x = behind ? -tmpV.x : tmpV.x;
  let y = behind ? -tmpV.y : tmpV.y;
  const onScreen = !behind && Math.abs(x) < 0.88 && Math.abs(y) < 0.8;
  let angle = Math.PI; // arrow points down at the lantern when it is on screen
  if (!onScreen) {
    const k = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.72, 1e-3);
    x /= k;
    y /= k;
    angle = Math.atan2(x, y);
  } else {
    y += 0.09;
    if (dist < 5) {
      ui.guide.style.opacity = "0";
      return;
    }
  }
  ui.guide.style.opacity = "1";
  ui.guide.style.transform = `translate(${((x + 1) / 2) * innerWidth}px, ${((1 - y) / 2) * innerHeight}px)`;
  (ui.guide.firstElementChild as HTMLElement).style.transform = `rotate(${angle}rad)`;
  ui.guideDist.textContent = `${Math.round(dist)}m`;
}

function updateCamera(dt: number) {
  const narrow = innerWidth < 760;
  if (state === "title" || state === "loading" || ATTRACT) {
    orbitAngle += dt * (reduceMotion ? 0.012 : 0.035);
    const r = (narrow ? 84 : 70) * TITLE_R;
    camPos.set(Math.sin(orbitAngle) * r, TITLE_H + Math.sin(orbitAngle * 0.7) * 2, Math.cos(orbitAngle) * r);
    lookTarget.set(0, TITLE_LOOK, 0);
    const targetShift = ATTRACT || narrow ? 0 : 0.15;
    viewShift = lerp(viewShift, targetShift, Math.min(1, dt * 2));
  } else if (state === "ended") {
    // Pull back to a wide shot so the rising lanterns fill the sky.
    orbitAngle += dt * (reduceMotion ? 0.015 : 0.05);
    camPos.set(Math.sin(orbitAngle) * 58, 16, Math.cos(orbitAngle) * 58);
    lookTarget.set(0, 9, 0);
    viewShift = lerp(viewShift, 0, Math.min(1, dt * 2));
  } else {
    const look = input.consumeLook();
    if (look.x || look.y) lastManualLook = time;
    camYaw -= look.x * 0.0055;
    camPitch = clamp(camPitch + look.y * 0.004, 0.08, 1.15);
    camDist = clamp(camDist + look.zoom * 0.8, 4, 13);
    // Drift behind the fox while running forward, unless the player is steering the camera.
    if (state === "playing" && time - lastManualLook > 1.5 && player.speed > 1) {
      let diff = player.heading + Math.PI - camYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      camYaw += diff * Math.min(1, dt * 0.9) * (player.speed / 9);
    }
    const p = player.position;
    lookTarget.set(p.x, p.y + 1.25, p.z);
    const cp = Math.cos(camPitch);
    camPos.set(p.x + Math.sin(camYaw) * camDist * cp, p.y + 1.25 + Math.sin(camPitch) * camDist, p.z + Math.cos(camYaw) * camDist * cp);
    if (world) camPos.y = Math.max(camPos.y, world.groundAt(camPos.x, camPos.z) + 0.6, 0.5);
    if (world && state === "playing") orbitAngle = Math.atan2(camPos.x - p.x, camPos.z - p.z);
    viewShift = lerp(viewShift, 0, Math.min(1, dt * 2.5));
  }
  camBlend = Math.min(1, camBlend + dt * 0.6);
  const following = state === "playing" || state === "paused";
  const rate = following ? 14 * camBlend * camBlend + 0.6 : 1.6;
  const k = firstFrame ? 1 : 1 - Math.exp(-dt * rate);
  firstFrame = false;
  camera.position.lerp(camPos, k);
  camLook.lerp(lookTarget, following ? Math.min(1, k * 1.5) : k);
  camera.lookAt(camLook);

  // Field-of-view kick on pickup.
  fovKick = Math.max(0, fovKick - dt * 2.5);
  const baseFov = camera.aspect < 0.8 ? 64 : 50; // portrait phones see a bit more
  const fov = baseFov + (state === "playing" ? Math.min(player.speed, 9) * 0.5 : 0) + fovKick * 3;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, dt * 4));
    camera.updateProjectionMatrix();
  }
  if (viewShift > 0.001) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * viewShift, 0, innerWidth, innerHeight);
  else if (camera.view?.enabled) camera.clearViewOffset();
}

renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  time += dt;

  // Game logic
  if (state === "playing" && world) {
    elapsed += dt;
    const inp = input.poll();
    const res = player.update(dt, inp, camYaw, world.groundAt, world.colliders);
    if (res.jumped) sound.jump();
    for (const l of lanterns) {
      if (l.state !== "idle") continue;
      const dx = l.hover.x - player.position.x;
      const dz = l.hover.z - player.position.z;
      const dy = l.hover.y - (player.position.y + 0.6);
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < 2) collect(l);
    }
    const left = DURATION - elapsed;
    ui.time.textContent = fmt(left);
    ui.fill.style.transform = `scaleX(${clamp(left / DURATION, 0, 1)})`;
    if (left <= 15) ui.sun.classList.add("late");
    const sec = Math.ceil(left);
    if (left <= 10 && sec !== lastTickSecond && sec > 0) {
      lastTickSecond = sec;
      sound.tick();
    }
    if (hintTimer > 0) {
      hintTimer -= dt * (player.speed > 1 ? 1.5 : 1);
      if (hintTimer <= 0) ui.hint.style.opacity = "0";
    }
    if (left <= 0 && state === "playing") finish(false);
  } else if (state === "ended" && world) {
    endTimer += dt;
    player.update(dt, null, camYaw, world.groundAt, world.colliders);
  } else if (state === "title" && world) {
    player.update(dt, null, camYaw, world.groundAt, world.colliders);
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove("show");
  }

  // Sky and light follow the sun.
  const targetDusk = state === "playing" || state === "paused" || state === "ended" ? 0.08 + 0.9 * clamp(elapsed / DURATION, 0, 1) : ATTRACT ? Number(params.get("dusk") ?? TITLE_DUSK) : TITLE_DUSK;
  dusk = lerp(dusk, targetDusk, Math.min(1, dt * (state === "playing" ? 4 : 1.2)));
  applyDusk(dusk);

  // World animation
  world?.update(time, dusk);
  for (const l of lanterns) l.update(dt, time, camera.position);
  for (const l of decoLanterns) {
    l.update(dt, time, camera.position);
    // wrap drifting decoration lanterns back over the sea
    if (l.hover.length() > 180) l.hover.multiplyScalar(0.45);
  }
  fireflies.update(time, dusk, pixelRatio);
  bursts.update(dt, pixelRatio);
  birds.update(time);
  water.material.uniforms.uTime.value = time;
  sky.material.uniforms.uTime.value = time;

  updateCamera(dt);
  setFocus(state === "playing" || state === "paused" ? camLook : null);
  sky.position.copy(camera.position);
  updateGuide();
  adaptQuality(dt);
  composer.render();
});

// Small hook for automated tests and the curious.
Object.assign(window, {
  __noeul: {
    get state() {
      return state;
    },
    get collected() {
      return collected;
    },
    get won() {
      return won;
    },
    get timeLeft() {
      return DURATION - elapsed;
    },
    get player() {
      const p = player.position;
      return { x: p.x, y: p.y, z: p.z, heading: player.heading };
    },
    pier: () => world && { start: world.pierStart, end: world.pierEnd },
    lanterns: () => lanterns.map((l) => ({ x: l.hover.x, y: l.hover.y, z: l.hover.z, state: l.state })),
    setCameraYaw(y: number) {
      camYaw = y;
      lastManualLook = time;
    },
    start: () => startGame(),
  },
});
