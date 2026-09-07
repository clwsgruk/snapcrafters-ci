import { expect, test } from "vitest";

import { testingBody, testingIssue } from "../src/testing.ts";
test("testing issue binds exact snap/repository/channels and revisions with legacy HTML table", () => {
  const context = {
    repository: "owner/repo",
    snap: "sample",
    channel: "latest/candidate",
    destination: "latest/stable",
    version: "2",
    rows: [{ name: "sample", architecture: "amd64", revision: "9007199254740993" }],
  };
  const body = testingBody(context, "Try {{ env.snap_name }} on {{ env.channel }}");
  expect(body).toContain("<tr><td>amd64</td><td>9007199254740993</td></tr>");
  expect(body).toContain("Try sample on latest/candidate");
  expect(testingIssue(body, "owner/repo", "sample", "latest/stable")).toEqual(context);
  expect(() =>
    testingIssue(
      body.replace("of `sample`", "of `other`"),
      "owner/repo",
      "sample",
      "latest/stable",
    ),
  ).toThrow(/context/);
  const legacy = body.slice(0, body.indexOf("<!-- snapcrafters-testing:"));
  expect(testingIssue(legacy, "owner/repo", "sample", "latest/stable")).toEqual(context);
  for (const args of [
    ["other/repo", "sample", "latest/stable"],
    ["owner/repo", "other", "latest/stable"],
    ["owner/repo", "sample", "latest/beta"],
  ])
    expect(() => testingIssue(body, ...(args as [string, string, string]))).toThrow();
});
