import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The native transmitter app in transmitter/ has its own tooling.
    exclude: ["**/node_modules/**", "transmitter/**", ".next/**"],
  },
});
