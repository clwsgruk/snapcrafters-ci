import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { actionContext } from "./context.js";

test("validates an absolute bounded GitHub Actions context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "context-"));
  const event = join(workspace, "event.json");
  await writeFile(event, "{}");
  await expect(
    actionContext({
      GITHUB_WORKSPACE: "relative",
      GITHUB_REPOSITORY: "snapcrafters/ci",
      GITHUB_RUN_ID: "1",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_EVENT_PATH: event,
    }),
  ).rejects.toThrow(/absolute/i);
  await expect(
    actionContext({
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "bad repo",
      GITHUB_RUN_ID: "1\n2",
      GITHUB_SHA: "nope",
      GITHUB_EVENT_PATH: event,
    }),
  ).rejects.toThrow();
  await expect(
    actionContext({
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "snapcrafters/ci",
      GITHUB_RUN_ID: "123",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_EVENT_PATH: event,
      GITHUB_EVENT_NAME: "push",
    }),
  ).resolves.toMatchObject({ workspace, repository: "snapcrafters/ci", runId: "123" });
});
