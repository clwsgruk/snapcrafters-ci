import { defineConfig } from "vite-plus";
export default defineConfig({
  lint: { ignorePatterns: ["**/dist/**"], options: { typeAware: true, typeCheck: true } },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { "src/project.ts": { branches: 90 }, "src/validation.ts": { branches: 90 } },
    },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "test-support/fixtures/**", "bun.lock"],
    printWidth: 100,
    experimentalSortImports: {
      groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
      newlinesBetween: true,
    },
  },
});
