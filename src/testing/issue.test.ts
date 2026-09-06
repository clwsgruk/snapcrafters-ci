import { expect, test } from "vite-plus/test";
import { createTestingIssue } from "./issue.js";

test("renders bundled template with manifest-bound revisions", async () => {
  let issue = { title: "", body: "" };
  const number = await createTestingIssue(
    {
      ciRepo: "snapcrafters/ci",
      snap: "demo",
      version: "1",
      channel: "latest/candidate",
      promotionChannel: "latest/stable",
      architectures: ["amd64"],
      manifests: [{ name: "demo", architecture: "amd64", revision: "4" }],
      instructions: "snap refresh {{ env.snap_name }} --channel {{ env.channel }}",
      deliveryMarker: `<!-- snapcrafters-ci:issue:1:${"a".repeat(40)} -->`,
    },
    {
      lookup: async () => undefined,
      createIssue: async (title, body) => {
        issue = { title, body };
        return 9;
      },
    },
  );
  expect(number).toBe(9);
  expect(issue.title).toContain("demo");
  expect(issue.body).toContain("<td>amd64</td><td>4</td>");
  expect(issue.body).toContain("/promote 4 latest/stable done");
  expect(issue.body).toContain("the snap will be installed in a VM");
  expect(issue.body).toContain("snap refresh demo --channel latest/candidate");
});

test("rejects template overrides and missing expected architectures before writes", async () => {
  let writes = 0;
  const deps = { lookup: async () => undefined, createIssue: async () => ++writes };
  await expect(
    createTestingIssue(
      {
        ciRepo: "fork/ci",
        snap: "demo",
        version: "1",
        channel: "latest/candidate",
        promotionChannel: "latest/stable",
        architectures: ["amd64"],
        manifests: [],
        instructions: "test",
        deliveryMarker: `<!-- snapcrafters-ci:issue:1:${"a".repeat(40)} -->`,
      },
      deps,
    ),
  ).rejects.toThrow(/immutable SHA/i);
  await expect(
    createTestingIssue(
      {
        ciRepo: "snapcrafters/ci",
        snap: "demo",
        version: "1",
        channel: "latest/candidate",
        promotionChannel: "latest/stable",
        architectures: ["amd64"],
        manifests: [{ name: "other", architecture: "amd64", revision: "1" }],
        instructions: "test",
        deliveryMarker: `<!-- snapcrafters-ci:issue:1:${"a".repeat(40)} -->`,
      },
      deps,
    ),
  ).rejects.toThrow(/snap/i);
  expect(writes).toBe(0);
});

test("uses the actual manifest version for an adopt-info project", async () => {
  let body = "";
  await createTestingIssue(
    {
      ciRepo: "snapcrafters/ci",
      snap: "demo",
      version: undefined as unknown as string,
      channel: "latest/candidate",
      promotionChannel: "latest/stable",
      architectures: ["amd64"],
      manifests: [{ name: "demo", architecture: "amd64", revision: "4", version: "9.4" } as never],
      instructions: "test",
      deliveryMarker: `<!-- snapcrafters-ci:issue:1:${"a".repeat(40)} -->`,
    },
    {
      lookup: async () => undefined,
      createIssue: async (_title, value) => {
        body = value;
        return 1;
      },
    },
  );
  expect(body).toContain("A new version (9.4)");
  expect(body).not.toContain("null");
});
