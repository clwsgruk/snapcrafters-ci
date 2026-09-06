import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { parse } from "yaml";
import { getBuildTargets } from "../../src/project/architectures.js";

interface Inventory {
  repositories: Array<{ repository: string; commit: string }>;
  recipes: Array<{
    repository: string;
    commit: string;
    blob: string;
    path: string;
    fixture: string;
  }>;
}

test("inventory covers every active repository and pins every recipe source blob", async () => {
  const root = resolve("test/fixtures/inventory");
  const inventory = JSON.parse(
    await readFile(resolve(root, "active-recipes.json"), "utf8"),
  ) as Inventory;
  expect(inventory.repositories).toHaveLength(87);
  expect(new Set(inventory.repositories.map((item) => item.repository)).size).toBe(87);
  expect(inventory.recipes.length).toBeGreaterThan(35);
  for (const recipe of inventory.recipes) {
    expect(recipe.commit).toMatch(/^[a-f0-9]{40}$/);
    const source = await readFile(resolve(root, "recipes", recipe.fixture));
    const header = Buffer.from(`blob ${source.length}\0`);
    expect(
      createHash("sha1").update(header).update(source).digest("hex"),
      `${recipe.repository}:${recipe.path}`,
    ).toBe(recipe.blob);
    const document = parse(source.toString("utf8")) as Record<string, unknown>;
    if (document.architectures === undefined && document.platforms === undefined) {
      expect(() => getBuildTargets(document), `${recipe.repository}:${recipe.path}`).toThrow(
        /declare architectures|declare platforms/i,
      );
    } else {
      expect(() => getBuildTargets(document), `${recipe.repository}:${recipe.path}`).not.toThrow();
    }
  }
});
