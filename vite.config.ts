import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs work both on custom domains and GitHub Pages subpaths.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    target: "es2022",
  },
});
