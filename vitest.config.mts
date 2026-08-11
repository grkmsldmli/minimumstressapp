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
  test: {
    /**
     * A git worktree under `.claude/` is a second checkout of this repo, and
     * its tests are a copy of these ones against a different commit. Left in,
     * the suite ran twice and the copy failed against its own fixtures — a red
     * result that says nothing about the code being changed.
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
