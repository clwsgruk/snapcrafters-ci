import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { project } from "../src/project.ts";
test("nested roots retain public spelling but resolve internal paths and last-match precedence", () => {
  const cwd = mkdtempSync(join(tmpdir(), "project-"));
  try {
    mkdirSync(join(cwd, "some root/snap"), { recursive: true });
    mkdirSync(join(cwd, ".github"));
    writeFileSync(join(cwd, "some root/snap/snapcraft.yaml"), "name: earlier\nversion: '1'\n");
    writeFileSync(
      join(cwd, "some root/snapcraft.yaml"),
      "name: chosen\nversion: '2'\ncomponents:\n  data: {}\nconfinement: classic\n",
    );
    writeFileSync(join(cwd, ".github/plug-declaration.json"), "{}");
    const p = project("some root/", cwd);
    expect(p.root).toBe(join(cwd, "some root"));
    expect(p.yaml).toBe(join(cwd, "some root/snapcraft.yaml"));
    expect(p.outputs).toMatchObject({
      "project-root": "some root/",
      "yaml-path": "some root//snapcraft.yaml",
      "snap-name": "chosen",
      version: "2",
      components: "data|null",
      classic: "true",
      "plugs-file": ".github/plug-declaration.json",
    });
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

test("architectures cover the fresh inventory and normalize lists without empty or nested matrices", async () => {
  const { architectures } = await import("../src/project.ts");
  const { default: shapes } = await import("./fixtures/shapes.json");
  for (const shape of Object.values(shapes)) {
    if (!("architectures" in shape) && !("platforms" in shape))
      expect(() => architectures(shape)).toThrow(/declare/);
    else {
      const result = architectures(shape);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((a) => typeof a === "string")).toBe(true);
      expect(result).toEqual([...new Set(result)]);
    }
  }
  expect(
    architectures({ base: "core22", architectures: [{ "build-on": ["amd64", "arm64"] }, "amd64"] }),
  ).toEqual(["amd64", "arm64"]);
  expect(
    architectures({
      base: "core24",
      platforms: { workstation: { "build-on": "amd64", "build-for": "arm64" } },
    }),
  ).toEqual(["arm64"]);
  for (const data of [
    { base: "core26", architectures: ["amd64"] },
    { base: "core24", platforms: {} },
    { base: "core24", platforms: { label: null } },
    { base: "core24", platforms: { amd64: { "build-for": ["amd64", "arm64"] } } },
    { architectures: [["amd64"]] },
    { architectures: ["any"] },
    { architectures: [] },
    { architectures: [{ "build-on": "amd64", mystery: true }] },
    { base: "core24", architectures: ["amd64"], platforms: { amd64: null } },
  ])
    expect(() => architectures(data)).toThrow();
});
