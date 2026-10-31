import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/…" imports as the app (tsconfig paths), so modules that use them can be tested.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Agent worktrees under .claude/ hold full copies of the repo; only test this one.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
