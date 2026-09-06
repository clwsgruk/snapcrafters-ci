import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "node_modules/**",
      "**/dist/**",
      "coverage/**",
      "test/fixtures/inventory/active-recipes.json",
      "test/fixtures/inventory/recipes/**",
    ],
    printWidth: 99,
    sortPackageJson: false,
  },
  lint: {
    ignorePatterns: ["node_modules/**", "**/dist/**", "coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/actions/inputs.ts", "src/manifests/codec.ts", "src/project/architectures.ts"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
