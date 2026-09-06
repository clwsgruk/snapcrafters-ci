import { expect, test } from "vitest";
import { expectedUses } from "./wrappers.ts";
import { smoke } from "./smoke.ts";
test.each(
  Object.keys(expectedUses).flatMap((name) => ["ubuntu22", "ubuntu24"].map((os) => [name, os])),
)("copied %s wrapper on %s runs with Node 24 and observable effects", async (name, os) => {
  const result = await smoke(name, { ImageOS: os });
  expect(result.code).toBe(0);
  expect(result.nodes).toBeGreaterThan(0);
  if (name === "parse-snapcraft-yaml") expect(result.outputs["snap-name"]).toBe("sample");
  if (name === "get-architectures") expect(result.outputs["architectures-list"]).toBe('["amd64"]');
  if (name === "release-to-candidate") expect(result.outputs.revision).toBe("12");
  if (name === "call-for-testing") expect(result.outputs["issue-number"]).toBe("1");
  if (name === "get-screenshots")
    expect(result.outputs.screen).toContain("/" + "e".repeat(40) + "/");
});
test("setup-ghvmctl invalid-host wrapper reaches no privileged executable", async () => {
  const result = await smoke("setup-ghvmctl", { RUNNER_ENVIRONMENT: "self-hosted" });
  expect(result.code).not.toBe(0);
  expect(result.commands).toEqual([]);
  expect(result.uses).toEqual([]);
});

test.each([0, 7])(
  "test result %s survives comment and summary failures in the public wrapper",
  async (status) => {
    const result = await smoke(
      "run-tests",
      {},
      {
        summaryFailure: true,
        inputs: { "test-script": `printf 'before failure\\n'; exit ${status}` },
        denyComments: true,
        expectFailure: true,
      },
    );
    expect(result.code).toBe(status);
  },
);
test("artifact failure after publication reports the exact partial success", async () => {
  const result = await smoke(
    "release-to-candidate",
    {},
    { artifactFailure: true, expectFailure: true },
  );
  expect(result.code).toBe(1);
  expect(result.diagnostic).toContain("Published sample revision 12");
  expect(result.outputs.revision).toBe("12");
  expect(result.commands.filter((s) => s.includes('"upload"'))).toHaveLength(1);
});

test("adopted versions in testing issues come from the exact Store revision", async () => {
  const result = await smoke("call-for-testing", {}, { adopted: true });
  expect(JSON.stringify(result.messages)).toContain("A new version (1)");
});
