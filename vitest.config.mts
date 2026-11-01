import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/…" imports as the app (tsconfig paths), so modules that use them can be tested.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Tests run as server code: give "server-only" its server build (empty), as Next does, instead of the
      // browser build that throws.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  // Agent worktrees under .claude/ hold full copies of the repo; only test this one.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
