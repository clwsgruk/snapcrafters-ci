import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { getBuildTargets } from "./architectures.js";
import { parseProject } from "./parse.js";

describe("project parsing", () => {
  test("preserves last-match precedence and public relative formatting", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "project space-"));
    await mkdir(join(workspace, "nested", "snap"), { recursive: true });
    await writeFile(join(workspace, "nested", ".snapcraft.yaml"), "name: first\nversion: '1'\n");
    await writeFile(
      join(workspace, "nested", "snap", "snapcraft.yaml"),
      "name: winner\nversion: '2'\nconfinement: classic\ncomponents:\n  docs: {}\n",
    );
    await writeFile(join(workspace, ".github-placeholder"), "");
    const project = await parseProject(workspace, "nested/");
    expect(project).toMatchObject({
      name: "winner",
      version: "2",
      classic: true,
      publicRoot: "nested/",
      publicYamlPath: "nested/snap/snapcraft.yaml",
      components: [{ name: "docs" }],
    });
    expect(project.yamlPath).toBe(join(workspace, "nested", "snap", "snapcraft.yaml"));
  });
});

describe("architecture normalization", () => {
  test.each([
    ["core22", { architectures: ["amd64", "arm64"] }, ["amd64", "arm64"]],
    [
      "core22",
      { architectures: [{ "build-on": ["amd64", "arm64"], "build-for": "arm64" }] },
      ["arm64"],
    ],
    [
      "core24",
      { platforms: { workstation: { "build-on": ["amd64"], "build-for": ["arm64"] } } },
      ["arm64"],
    ],
    ["core24", { platforms: { amd64: null, arm64: null } }, ["amd64", "arm64"]],
  ])("normalizes %s inventory schema", (base, fields, expected) => {
    expect(getBuildTargets({ base, ...fields })).toEqual(
      expected.map((buildFor) => expect.objectContaining({ buildFor })),
    );
  });

  test("rejects omitted and ambiguous declarations", () => {
    expect(() => getBuildTargets({ base: "core22" })).toThrow(
      /declare architectures or platforms/i,
    );
    expect(() => getBuildTargets({ base: "core24", architectures: ["amd64"] })).toThrow(
      /platforms/i,
    );
    expect(() => getBuildTargets({ base: "core24", platforms: { label: null } })).toThrow(
      /label/i,
    );
  });
});
