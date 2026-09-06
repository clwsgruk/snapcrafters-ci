import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { actionContext } from "../actions/context.js";
import { runGhvmctlSetupAction } from "./setup.js";

afterEach(() => vi.unstubAllEnvs());

async function setup(exitCode = 0) {
  const root = await mkdtemp(join(tmpdir(), "setup-ghvmctl-test-"));
  const event = join(root, "event.json");
  const log = join(root, "observed");
  await writeFile(event, "{}");
  await writeFile(
    join(root, "sudo"),
    `#!/bin/bash\nprintf '%s\\n' "$*" >> '${log}'\nexit ${exitCode}\n`,
    { mode: 0o700 },
  );
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_WORKSPACE: root,
    GITHUB_REPOSITORY: "apps/demo",
    GITHUB_RUN_ID: "7",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_EVENT_PATH: event,
    GITHUB_EVENT_NAME: "push",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    ImageOS: "ubuntu24",
    PATH: root,
  }))
    vi.stubEnv(name, value);
  return { log };
}

test("setup invokes only the two exact sudo snap commands after context validation", async () => {
  const fixture = await setup();
  await configuredSetup();
  expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toEqual([
    "snap install ghvmctl",
    "snap connect ghvmctl:lxd lxd:lxd",
  ]);
});

test("setup rejects process failure and invalid context without continuing", async () => {
  const fixture = await setup(9);
  await expect(configuredSetup()).rejects.toThrow(/failed \(9\)/i);
  expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toHaveLength(1);
  vi.stubEnv("RUNNER_ENVIRONMENT", "self-hosted");
  await expect(configuredSetup()).rejects.toThrow(/runner capability/i);
  expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toHaveLength(1);
});

function configuredSetup() {
  return runGhvmctlSetupAction(process.env, {
    context: (env) => actionContext(env, "24.20.0"),
  });
}
