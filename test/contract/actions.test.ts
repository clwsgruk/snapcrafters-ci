import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contracts: Record<string, string> = {
  "call-for-testing": "e7148d921b4d86ff9f2068413e0c0ad178aa8d3d340a6f9e8b820936ff3c3027",
  "fetch-manifests": "c14a72382364d5954e5b7e232e47c4eec75835a0f5135e54294f3dde0bb56bd1",
  "get-architectures": "5930e1b45c5cd4f6a126fa12996a5026b4a1152465332e059f76b5513ac1f72d",
  "get-screenshots": "749c769aa698d7f2ab88c4c41e0e7b73cdae28e44987a619273f266269293ce0",
  "parse-snapcraft-yaml": "a67ec1517c4ab90f6c3eeb9b2b5ec0296b0bd682f42e1108ee5e294e43662598",
  "promote-to-stable": "518a5f4f75ec4cf1a9cdd2d10369dbf98a9a0199509b6c3ce9ef27f698a29a70",
  "release-to-candidate": "fcfcb64c3290b13e998ee43f6badca067bede0d95c13baba9e87080d51be7576",
  "review-snap": "df89141bacd5fd0caaeab23044ade7064fbe71b75bdb160ce03c3f3294b3b058",
  "run-tests": "035dd39cbecb485c2f429e970530e372b74c80cadb121cf63bab14e64da64cb7",
  "setup-ghvmctl": "a64aedf26113a2401d43224df470b3de265fc1da89677e43e4d36591b79cae43",
  "sync-version": "027691500dd90e8aa2863468a36bbfd29028f9ef4a4fb082d1bcb17f57e44b4a",
  "test-snap-build": "0a7c62c7be508fe1534d74e2b0fddf522989029f6ef414c4bcd7d0e7e3ed4943",
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("public action contracts", () => {
  test("all twelve action directories exactly preserve public metadata and own an adapter", async () => {
    const actual = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && contracts[entry.name])
      .map((entry) => entry.name)
      .sort();
    expect(actual).toEqual(Object.keys(contracts).sort());
    for (const action of actual) {
      const source = await readFile(resolve(root, action, "action.yaml"), "utf8");
      const metadata = parse(source) as Record<string, unknown>;
      const publicContract = Object.fromEntries(
        ["name", "description", "author", "branding", "inputs", "outputs"]
          .filter((key) => key in metadata)
          .map((key) => [key, metadata[key]]),
      );
      expect(createHash("sha256").update(stable(publicContract)).digest("hex"), action).toBe(
        contracts[action],
      );
      const adapter = await readFile(resolve(root, action, "main.ts"), "utf8");
      expect(adapter, action).toBeTruthy();
      const lines = adapter.trimEnd().split("\n").length;
      expect(lines, `${action} adapter lines`).toBeGreaterThanOrEqual(10);
      expect(lines, `${action} adapter lines`).toBeLessThanOrEqual(30);
      expect(source, action).not.toContain("snapcrafters/ci/");
      expect(source, action).not.toContain("@main");
      const inputs = (metadata.inputs ?? {}) as Record<string, unknown>;
      for (const input of Object.keys(inputs)) {
        if (action === "release-to-candidate" && input === "repo-token") {
          expect(source).toContain("token: ${{ inputs.repo-token }}");
          continue;
        }
        expect(source, `${action}:${input}`).toContain(
          `INPUT_${input.toUpperCase().replaceAll("-", "_")}:`,
        );
      }
      const runs = metadata.runs as { using?: unknown; steps?: unknown };
      expect(runs.using, action).toBe("composite");
      expect(Array.isArray(runs.steps), action).toBe(true);
      const ids = new Set<string>();
      for (const [index, rawStep] of (runs.steps as unknown[]).entries()) {
        expect(rawStep && typeof rawStep === "object", `${action}:step ${index}`).toBe(true);
        const step = rawStep as Record<string, unknown>;
        expect(
          typeof step.uses === "string" || typeof step.run === "string",
          `${action}:step ${index}`,
        ).toBe(true);
        if (step.uses !== undefined) {
          expect(step.uses, `${action}:step ${index}`).toMatch(
            /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/,
          );
        }
        if (step.run !== undefined) expect(step.shell, `${action}:step ${index}`).toBe("bash");
        expect(
          step.env === undefined || (step.env !== null && typeof step.env === "object"),
          `${action}:step ${index} env`,
        ).toBe(true);
        if (typeof step.id === "string") {
          expect(ids.has(step.id), `${action}:duplicate step id ${step.id}`).toBe(false);
          ids.add(step.id);
        }
      }
      if (action === "release-to-candidate") {
        const publish = (runs.steps as Array<Record<string, unknown>>).find(
          (step) => step.id === "publish",
        );
        expect(publish?.env).not.toHaveProperty("INPUT_REPO_TOKEN");
      }
      if (action === "setup-ghvmctl") {
        const steps = runs.steps as Array<Record<string, unknown>>;
        expect(steps[0]?.name).toBe("Validate hosted runner");
        expect(steps[0]?.run).not.toContain("sudo");
        expect(
          steps.findIndex((step) => typeof step.run === "string" && step.run.includes("sudo")),
        ).toBeGreaterThan(0);
        expect(
          steps.findIndex(
            (step) => typeof step.run === "string" && step.run.includes("dist/index.cjs"),
          ),
        ).toBeLessThan(
          steps.findIndex((step) => typeof step.run === "string" && step.run.includes("sudo")),
        );
      }
    }
  });
});
