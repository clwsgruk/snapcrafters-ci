import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";
const contracts = readdirSync("test/fixtures/contracts");
test("all twelve public metadata blocks are byte-for-byte preserved", () => {
  expect(contracts).toHaveLength(12);
  for (const file of contracts)
    expect(readFileSync(`${file.slice(0, -4)}/action.yaml`, "utf8").split("runs:")[0]).toBe(
      readFileSync(`test/fixtures/contracts/${file}`, "utf8"),
    );
});
