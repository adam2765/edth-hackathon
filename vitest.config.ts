import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" shortcut as tsconfig.json, so tests can import the app's routes.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // The native transmitter app in transmitter/ has its own tooling.
    exclude: ["**/node_modules/**", "transmitter/**", ".next/**"],
  },
});
