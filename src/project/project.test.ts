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
    [
      undefined,
      { architectures: [{ "build-on": "amd64", "run-on": ["amd64", "i386"] }] },
      ["amd64", "i386"],
    ],
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

  test.each([
    [{ base: "core26", platforms: { amd64: null } }, /base/i],
    [{ base: 22, architectures: ["amd64"] }, /base/i],
    [{ base: "core22", architectures: [] }, /non-empty/i],
    [{ base: "core22", architectures: "amd64" }, /non-empty/i],
    [{ base: "core22", architectures: [null] }, /ambiguous/i],
    [{ base: "core22", architectures: [{ "build-on": [] }] }, /empty/i],
    [{ base: "core22", architectures: [{ "build-on": "sparc" }] }, /unsupported/i],
    [
      {
        base: "core22",
        architectures: [{ "build-on": "amd64", "build-for": "amd64", "run-on": "amd64" }],
      },
      /both/i,
    ],
    [{ base: "core24", platforms: [] }, /mapping/i],
    [{ base: "core24", platforms: {} }, /non-empty/i],
    [{ base: "core24", platforms: { amd64: "amd64" } }, /ambiguous/i],
    [
      {
        base: "core24",
        platforms: { amd64: { "build-on": [], "build-for": "amd64" } },
      },
      /empty/i,
    ],
    [
      {
        base: "core24",
        platforms: { amd64: { "build-on": "amd64", "build-for": [] } },
      },
      /empty|one build-for/i,
    ],
  ])("rejects unsupported architecture schema %#", (document, error) => {
    expect(() => getBuildTargets(document)).toThrow(error);
  });

  test("deduplicates repeated target architectures", () => {
    expect(getBuildTargets({ base: "core22", architectures: ["amd64", "amd64"] })).toEqual([
      { buildOn: ["amd64"], buildFor: "amd64" },
    ]);
  });
});
