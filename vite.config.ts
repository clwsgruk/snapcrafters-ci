import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["node_modules/**", "**/dist/**", "coverage/**"],
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
    },
  },
});
