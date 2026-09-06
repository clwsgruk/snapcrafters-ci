import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { actionContext } from "./context.js";

test("validates an absolute bounded GitHub Actions context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "context-"));
  const event = join(workspace, "event.json");
  await writeFile(event, "{}");
  await expect(
    actionContext(
      validEnvironment(workspace, event, {
        GITHUB_WORKSPACE: "relative",
      }),
      "24.20.0",
    ),
  ).rejects.toThrow(/absolute/i);
  await expect(
    actionContext(
      validEnvironment(workspace, event, {
        GITHUB_REPOSITORY: "bad repo",
        GITHUB_RUN_ID: "1\n2",
        GITHUB_SHA: "nope",
      }),
      "24.20.0",
    ),
  ).rejects.toThrow();
  await expect(
    actionContext(
      validEnvironment(workspace, event, {
        GITHUB_RUN_ID: "123",
      }),
      "24.20.0",
    ),
  ).resolves.toMatchObject({ workspace, repository: "snapcrafters/ci", runId: "123" });
});

test("rejects unsupported runner capabilities before reading the event", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "context-runner-"));
  const missing = join(workspace, "missing.json");
  for (const override of [
    { GITHUB_SERVER_URL: "https://enterprise.invalid" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { RUNNER_OS: "Windows" },
    { ImageOS: "ubuntu20" },
    { GITHUB_ACTIONS: "false" },
  ]) {
    await expect(
      actionContext(validEnvironment(workspace, missing, override), "24.20.0"),
    ).rejects.toThrow(/unsupported|github actions/i);
  }
  await expect(actionContext(validEnvironment(workspace, missing), "22.0.0")).rejects.toThrow(
    /unsupported/i,
  );
});

test("rejects oversized event files from metadata before allocating their contents", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "context-size-"));
  const event = join(workspace, "event.json");
  await writeFile(event, "{}");
  await truncate(event, 2 * 1024 * 1024 + 1);
  await expect(actionContext(validEnvironment(workspace, event), "24.20.0")).rejects.toThrow(
    /size limit/i,
  );
});

function validEnvironment(
  workspace: string,
  event: string,
  override: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "snapcrafters/ci",
    GITHUB_RUN_ID: "1",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_EVENT_PATH: event,
    GITHUB_EVENT_NAME: "push",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    ImageOS: "ubuntu24",
    ...override,
  };
}
