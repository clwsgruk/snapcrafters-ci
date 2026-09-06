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
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 88,
        statements: 85,
        "src/actions/{context-validation,inputs}.ts": pureThresholds(),
        "src/manifests/codec.ts": pureThresholds(),
        "src/project/{architectures,schema}.ts": pureThresholds(),
        "src/promotion/parse.ts": pureThresholds(),
        "src/release/{state,store-output}.ts": pureThresholds(),
        "src/runtime/retry.ts": pureThresholds(),
        "src/screenshots/validation.ts": pureThresholds(),
      },
    },
  },
});

function pureThresholds() {
  return { branches: 90, functions: 90, lines: 90, statements: 90 };
}
