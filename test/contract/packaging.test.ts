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

test("wrapper output keys and prerequisite steps are wired to their public contracts", async () => {
  const architectures = await readFile("src/project/action.ts", "utf8");
  expect(architectures).toContain('setOutput("architectures_list"');
  const promotion = await readFile("promote-to-stable/action.yaml", "utf8");
  expect(promotion).toContain("actions/checkout@");
  const screenshots = await readFile("src/screenshots/action.ts", "utf8");
  expect(screenshots).toContain("runGhvmctlSetupAction");
});
