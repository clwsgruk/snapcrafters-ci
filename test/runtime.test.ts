import { expect, test } from "vitest";
import { validateRunner } from "../src/runtime.ts";
test("only github.com-hosted Ubuntu 22/24 with Node 24 passes the publishing boundary", () => {
  const good = {
    GITHUB_SERVER_URL: "https://github.com",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    ImageOS: "ubuntu24",
  };
  expect(() => validateRunner(good, "v24.20.0")).not.toThrow();
  for (const patch of [
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_SERVER_URL: "https://example.org" },
    { ImageOS: "ubuntu20" },
    { RUNNER_OS: "Windows" },
  ])
    expect(() => validateRunner({ ...good, ...patch }, "v24.20.0")).toThrow();
  expect(() => validateRunner(good, "v22.0.0")).toThrow();
});
