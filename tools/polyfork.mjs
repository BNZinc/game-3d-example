#!/usr/bin/env node
// Polyfork (polyfork.dev) helper for the assets role. Free low-poly models, no key needed.
//
//   node tools/polyfork.mjs search "pine tree" [class]   list matching free models
//   node tools/polyfork.mjs get <id> <file-name>          download its GLB to public/assets/<file-name>.glb
//                                                        and add the credit line to CREDITS.md
//
// Polyfork's own guide for agents: https://polyfork.dev/llms.txt
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://polyfork.dev/api";
const [cmd, ...args] = process.argv.slice(2);

async function json(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

if (cmd === "search") {
  const [q, cls] = args;
  if (!q) throw new Error('usage: search "<words>" [prop|building|vehicle|character|animal|terrain]');
  const params = new URLSearchParams({ q, free: "1", per_page: "15", fields: "compact" });
  if (cls) params.set("class", cls);
  const data = await json(`${API}/assets?${params}`);
  for (const a of data.assets ?? []) {
    const size = a.size_m ? `${a.size_m.x}×${a.size_m.y}×${a.size_m.z}m` : "";
    console.log(`${a.id}\t${a.title}\t${a.class ?? ""}\t${a.triangles ?? ""} tris\t${size}`);
  }
  if (!data.assets?.length) console.log("(no match — try other words)");
} else if (cmd === "get") {
  const [id, name] = args;
  if (!id || !name) throw new Error("usage: get <id> <file-name>");
  const asset = await json(`${API}/assets/${encodeURIComponent(id)}`);
  const url = asset.download?.glb;
  if (!url) throw new Error(`no free GLB for ${id}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const dir = join("public", "assets");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name.replace(/\.glb$/i, "")}.glb`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // Polyfork's own credit line and licence, as its API gives them (CC BY 4.0 for mesh files).
  const credit = String(asset.credit ?? `${asset.title} by Polyfork (${asset.page ?? `https://polyfork.dev/asset/${id}`})`).replace(/\s+/g, " ").replace(/\|/g, "\\|");
  const date = new Date().toISOString().slice(0, 10);
  const line = `| ${file.replace(/^public\//, "")} | ${credit} | [licensing](https://polyfork.dev/licensing) · 받은 날 ${date} |\n`;
  // A new file gets its own credit: an older line for the same file (another Polyfork model, or one
  // made with Blender) is replaced, never kept next to it.
  const cell = `| ${file.replace(/^public\//, "")} |`;
  const kept = readFileSync("CREDITS.md", "utf8").split("\n").filter((l) => !l.startsWith(cell));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  writeFileSync("CREDITS.md", `${kept.join("\n")}\n${line}`);
  console.log(`saved ${file} (${asset.title}, ${asset.triangles ?? "?"} tris, ${JSON.stringify(asset.size_m ?? {})})`);
} else {
  console.log('node tools/polyfork.mjs search "<words>" [class] | get <id> <file-name>');
}
