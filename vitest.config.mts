import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Agent worktrees under .claude/ hold full copies of the repo; only test this one.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
