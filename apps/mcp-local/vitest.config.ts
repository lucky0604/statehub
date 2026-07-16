import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.spec.ts"],
    exclude: ["node_modules/**", "dist/**"],
    globals: false,
  },
  resolve: {
    alias: {
      "@statehub/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
});
