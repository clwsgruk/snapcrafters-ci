import { expect, test } from "vite-plus/test";
import { main } from "./main.js";

test("adapter has a dependency-free smoke path", async () => {
  process.env.SNAPCRAFTERS_CI_SMOKE = "1";
  await expect(main()).resolves.toBeUndefined();
});
