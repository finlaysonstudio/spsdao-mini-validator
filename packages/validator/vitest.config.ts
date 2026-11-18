import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.mts"],
    // Consensus pow on Node >= 24 (see src/util/mathpow.mts); forks pool passes V8 flags to workers.
    pool: "forks",
    execArgv: ["--no-use-std-math-pow"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
