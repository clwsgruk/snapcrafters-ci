import { expect, test } from "vitest";
import { expectedUses } from "./wrappers.ts";
import { smoke } from "./smoke.ts";
test.each(Object.keys(expectedUses))(
  "copied %s wrapper runs with Node 24 and observable effects",
  async (name) => {
    const result = await smoke(name);
    expect(result.code).toBe(0);
    expect(result.nodes).toBeGreaterThan(0);
    if (name === "parse-snapcraft-yaml") expect(result.outputs["snap-name"]).toBe("sample");
    if (name === "get-architectures")
      expect(result.outputs["architectures-list"]).toBe('["amd64"]');
    if (name === "release-to-candidate") expect(result.outputs.revision).toBe("12");
    if (name === "call-for-testing") expect(result.outputs["issue-number"]).toBe("1");
    if (name === "get-screenshots")
      expect(result.outputs.screen).toContain("/" + "e".repeat(40) + "/");
  },
);
test("setup-ghvmctl invalid-host wrapper reaches no privileged executable", async () => {
  const result = await smoke("setup-ghvmctl", { RUNNER_ENVIRONMENT: "self-hosted" });
  expect(result.code).not.toBe(0);
  expect(result.commands).toEqual([]);
  expect(result.uses).toEqual([]);
});
