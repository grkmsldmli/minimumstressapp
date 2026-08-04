import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The `@/` alias, which the app uses everywhere and the tests did not have.
 *
 * It went unnoticed because the only files importing `@/...` were route tests
 * that mocked every one of those specifiers — a mock intercepts before
 * resolution, so nothing ever had to resolve. The first genuine `@/` import
 * failed immediately, which is a confusing error for a path that works in the
 * app and in the editor.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
