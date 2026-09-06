import { defineConfig } from "vite-plus";
export default defineConfig({
  lint: { ignorePatterns: ["**/dist/**"], options: { typeAware: true, typeCheck: true } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 20000 },
  fmt: { ignorePatterns: ["**/dist/**", "test/fixtures/**", "bun.lock"] },
});
