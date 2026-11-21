import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".run/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The native transmitter app has its own tooling.
    "transmitter/**",
    // Other sessions' worktrees: each is a whole copy of the repo, linted in its own checkout.
    ".claude/worktrees/**",
    // Copied from node_modules by `predev` and `prebuild`, and ignored by git.
    "public/maplibre-gl-worker.mjs",
    "public/ort/**",
    "public/tts/**",
  ]),
]);

export default eslintConfig;
