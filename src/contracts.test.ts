import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";
import { parse } from "yaml";

const contracts = readdirSync("test-support/fixtures/contracts");
test("all twelve public metadata blocks are byte-for-byte preserved", () => {
  expect(contracts).toHaveLength(12);
  for (const file of contracts)
    expect(readFileSync(`${file.slice(0, -4)}/action.yaml`, "utf8").split("runs:")[0]).toBe(
      readFileSync(`test-support/fixtures/contracts/${file}`, "utf8"),
    );
});

test("prek always formats and regenerates bundles before validation", () => {
  const config = parse(readFileSync(".pre-commit-config.yaml", "utf8")) as {
    repos: Array<{
      repo: string;
      hooks: Array<{
        id: string;
        entry: string;
        always_run: boolean;
        pass_filenames: boolean;
      }>;
    }>;
  };
  const local = config.repos.find((repo) => repo.repo === "local");
  expect(local?.hooks.map((hook) => hook.id)).toEqual([
    "format",
    "regenerate-action-bundles",
    "check",
    "size",
  ]);
  expect(local?.hooks.every((hook) => hook.always_run && !hook.pass_filenames)).toBe(true);
  expect(local?.hooks[1].entry).toBe("mise run build");
  expect(readFileSync("mise.toml", "utf8")).toContain('prek = "0.5.2"');
});
