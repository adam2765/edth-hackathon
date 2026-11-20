// Copies MapLibre's module worker into /public so the browser can load it at a stable URL.
// Next's bundler rewrites import.meta.url, which breaks MapLibre's default worker lookup.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs -> public/");
