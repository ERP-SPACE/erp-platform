import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC (not esbuild) so decorator metadata is emitted — NestJS DI depends on it.
const plugins = [swc.vite({ module: { type: "es6" } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: { name: "unit", include: ["test/unit/**/*.test.ts"] },
      },
      {
        plugins,
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
