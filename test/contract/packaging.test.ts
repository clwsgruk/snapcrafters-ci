import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { actions } from "../../scripts/actions.js";

test("production adapters have no smoke bypass", async () => {
  for (const action of actions) {
    const source = await readFile(resolve(action, "main.ts"), "utf8");
    expect(source, action).not.toContain("SNAPCRAFTERS_CI_SMOKE");
  }
});

test("distribution verification uses pinned Node and independent source trees", async () => {
  const source = await readFile("scripts/check-dist.ts", "utf8");
  expect(source).not.toContain("process.execPath");
  expect(source).toContain('spawn("node"');
  expect(source).toContain("copySourceTree");
});
