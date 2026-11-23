import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so the same build works at a domain root (Railway) and under a sub-path
  // (GitHub Pages: https://bnzinc.github.io/game-3d-example/).
  base: "./",
  // three.js alone is ~600 kB, so one bundle of this size is expected for a 3D game.
  build: { chunkSizeWarningLimit: 1000 },
});
