#!/usr/bin/env node
// Blender helper: makes the game's own (original) models with Blender, with no window.
//
//   node tools/blender.mjs check          is Blender on this computer? (path, version)
//   node tools/blender.mjs make <name>    runs assets-src/<name>.py in Blender and saves
//                                         public/assets/<name>.glb, plus its CREDITS.md line
//
// Blender runs as
//   Blender -b --factory-startup --disable-autoexec --offline-mode -noaudio --python-exit-code 1
//           --python assets-src/<name>.py --python tools/blender/export.py -- public/assets/<name>.glb
// No window, none of the user's own add-ons or settings, no scripts stored inside .blend files, no
// online features. What Blender writes for itself goes to .questivibe/blender/. No Blender MCP, no
// add-on, no open port.
//
// `make` without Blender (or with one older than 4.2) says so and leaves a note for the QuestiVibe
// app (.questivibe/requests/blender.json), which then shows the user how to install it. `check`
// only reports. It never downloads or installs anything. Works from any folder of the project.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The project root is the folder above tools/, wherever this is run from.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const MIN = [4, 2];
const [cmd, name] = process.argv.slice(2);

function candidates() {
  const list = [];
  if (process.env.BLENDER_PATH) list.push(process.env.BLENDER_PATH);
  list.push("/Applications/Blender.app/Contents/MacOS/Blender", join(homedir(), "Applications", "Blender.app", "Contents", "MacOS", "Blender"));
  for (const dir of (process.env.PATH ?? "").split(delimiter)) if (dir) list.push(join(dir, process.platform === "win32" ? "blender.exe" : "blender"));
  return list;
}

const fail = (text) => {
  console.error(text);
  process.exit(1);
};

/**
 * { path, version: "5.3.0", ok } for the first Blender found; { path, version: null } when it is
 * there but did not say its version (the first run after a download can be slow); or null.
 */
function findBlender() {
  let silent = null;
  for (const path of candidates()) {
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    const out = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 60_000 });
    const version = `${out.stdout ?? ""}`.match(/Blender (\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
    if (!version) {
      silent ??= { path, version: null, ok: false };
      continue;
    }
    const [a, b] = version.split(".").map(Number);
    return { path, version, ok: a > MIN[0] || (a === MIN[0] && b >= MIN[1]) };
  }
  return silent;
}

/** Blender is there but gave no version: no note for the app (it cannot tell either). */
function unknownVersion(found) {
  console.log(`Blender 버전을 확인하지 못했어요(${found.path}). 사용자에게 한 줄로 알려 주세요: "Blender를 확인하지 못했어요. 앱에서 Blender [다시 확인]을 눌러 주세요."`);
  process.exit(2);
}

/** Replaces this file's line in CREDITS.md (a new file gets a new credit), or adds it. */
function setCredit(file, line) {
  const credits = existsSync("CREDITS.md") ? readFileSync("CREDITS.md", "utf8") : "";
  const cell = `| ${file} |`;
  const kept = credits.split("\n").filter((l) => !l.startsWith(cell));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  writeFileSync("CREDITS.md", `${kept.join("\n")}\n${line}\n`);
}

/** Asks the app to show its "Blender 설치하기" card; the agent tells the user in one line. */
function needBlender(found, what) {
  mkdirSync(join(".questivibe", "requests"), { recursive: true });
  writeFileSync(join(".questivibe", "requests", "blender.json"), JSON.stringify({ at: new Date().toISOString(), reason: found ? "old" : "missing", version: found?.version ?? null, what: what ?? null }) + "\n");
  console.log(
    found
      ? `Blender ${found.version} 버전은 너무 오래됐어요(4.2 이상 필요). 사용자에게 한 줄로 알려 주세요: "지금 있는 Blender가 오래돼서 직접 만들 수 없어요. 앱의 Blender 안내로 새 버전을 받으면 만들 수 있어요." 그리고 무엇으로 대신했는지 짧게 말해요. 설치는 하지 마세요.`
      : `Blender가 없어요. 사용자에게 한 줄로 알려 주세요: "Blender가 없어서 지금은 직접 만들 수 없어요. 앱의 Blender 안내로 설치하면 만들 수 있어요." 그리고 무엇으로 대신했는지(Polyfork 모델·임시 도형) 짧게 말해요. 설치는 하지 마세요.`,
  );
  process.exit(2);
}

if (cmd === "check") {
  const found = findBlender();
  if (!found) {
    console.log("Blender 없음. 사용자가 직접 만든 모델을 분명히 원했을 때만 node tools/blender.mjs make <이름> 을 실행해요(앱이 설치 안내를 보여 줘요). 아니면 Polyfork 모델이나 임시 도형으로 해요.");
    process.exit(2);
  }
  if (!found.version) unknownVersion(found);
  console.log(`Blender ${found.version} · ${found.path}${found.ok ? "" : " (4.2 이상 필요)"}`);
  process.exit(found.ok ? 0 : 2);
} else if (cmd === "make") {
  if (!name || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name)) fail("usage: make <name>   (영어 소문자·숫자·-·_; assets-src/<name>.py를 실행해요)");
  // Blender first: without it, no script is needed to get the app's install card.
  const found = findBlender();
  if (found && !found.version) unknownVersion(found);
  if (!found || !found.ok) needBlender(found, name);
  const script = join("assets-src", `${name}.py`);
  if (!existsSync(script)) fail(`${script}가 없어요. 먼저 그 파일에 모델을 만드는 bpy 코드를 써 주세요(AGENTS.md 참고).`);

  mkdirSync(join("public", "assets"), { recursive: true });
  const out = join("public", "assets", `${name}.glb`);
  const home = resolve(".questivibe", "blender");
  // Blender writes here first; public/assets/<name>.glb (maybe a Polyfork model) is replaced only
  // when this run worked, and a file left from an earlier run never passes for this one's.
  const tmp = join(home, `${name}.glb`);
  mkdirSync(home, { recursive: true });
  rmSync(tmp, { force: true });
  const env = { ...process.env };
  for (const [key, dir] of [["BLENDER_USER_RESOURCES", "resources"], ["BLENDER_USER_CONFIG", "config"], ["BLENDER_USER_SCRIPTS", "scripts"], ["BLENDER_USER_DATAFILES", "datafiles"], ["BLENDER_USER_EXTENSIONS", "extensions"]]) {
    env[key] = join(home, dir);
    mkdirSync(env[key], { recursive: true });
  }
  const args = ["-b", "--factory-startup", "--disable-autoexec", "--offline-mode", "-noaudio", "--python-exit-code", "1", "--python", script, "--python", join("tools", "blender", "export.py"), "--", tmp];
  const run = spawnSync(found.path, args, { encoding: "utf8", env, timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const log = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const result = log.match(/^QV_GLB (\{.*\})$/m);
  if (run.status !== 0 || !result || !existsSync(tmp)) {
    rmSync(tmp, { force: true });
    console.log(log.split("\n").filter(Boolean).slice(-40).join("\n"));
    console.error(run.error?.code === "ETIMEDOUT" ? "Blender가 10분 안에 끝나지 않았어요. 모델을 더 단순하게 만들어 보세요." : `Blender가 실패했어요(코드 ${run.status}). 위 오류를 보고 ${script}를 고쳐 다시 실행해 주세요.`);
    process.exit(1);
  }
  renameSync(tmp, out);
  const info = JSON.parse(result[1]);
  // The game's own model: credited to this project, with the script that made it.
  const file = out.replace(/\\/g, "/").replace(/^public\//, "");
  const date = new Date().toISOString().slice(0, 10);
  setCredit(file, `| ${file} | 직접 만듦 — 이 프로젝트에서 Blender로 만들었어요 (만든 코드: ${script.replace(/\\/g, "/")}) | 이 게임의 것 · 만든 날 ${date} |`);
  const s = info.size_m;
  console.log(`saved ${out} (${info.triangles} tris, ${s.x}×${s.y}×${s.z}m, Blender ${found.version})`);
} else {
  console.log("usage: node tools/blender.mjs check | make <name>");
  process.exit(1);
}
