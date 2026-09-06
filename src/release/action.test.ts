import { access, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { runReleaseAction } from "./action.js";
import type { ReleaseDependencies, ReleaseInput } from "./run.js";
import type { Published } from "./types.js";

async function context(state: Published): Promise<{ env: NodeJS.ProcessEnv; statePath: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "release-action-"));
  const eventPath = join(workspace, "event.json");
  const output = join(workspace, "output");
  await writeFile(eventPath, "{}");
  await writeFile(output, "");
  await writeFile(
    join(workspace, "snapcraft.yaml"),
    "name: demo\nbase: core24\nversion: '1.0'\nplatforms:\n  amd64:\n",
  );
  const statePath = join(workspace, ".snapcrafters-release-amd64.json");
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  return {
    statePath,
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "apps/demo",
      GITHUB_RUN_ID: "7",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: "push",
      GITHUB_OUTPUT: output,
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_OS: "Linux",
      ImageOS: "ubuntu24",
      INPUT_ARCHITECTURE: "amd64",
      INPUT_CHANNEL: "latest/candidate",
      INPUT_LAUNCHPAD_TOKEN: "launchpad-token",
      INPUT_STORE_TOKEN: "store-token",
    },
  };
}

const state = (): Published => ({
  snap: "demo",
  version: "1.0",
  revision: "9007199254740993",
  channel: "latest/candidate",
  architecture: "amd64",
  digest: "b".repeat(96),
  sourceSha: "a".repeat(40),
});

test("resumes an exact publication state before build or Store orchestration", async () => {
  const fixture = await context(state());
  const release = vi.fn();
  await runReleaseAction(fixture.env, { release, context: fakeContext(fixture.env) });
  expect(release).not.toHaveBeenCalled();
  expect(await readFile(join(fixture.env.GITHUB_WORKSPACE!, "manifest-amd64.yaml"), "utf8")).toBe(
    'name: demo\narchitecture: amd64\nrevision: 9007199254740993\nversion: "1.0"\n',
  );
});

test("rejects mismatched publication state before build or Store orchestration", async () => {
  const fixture = await context({ ...state(), channel: "latest/stable" });
  const release = vi.fn();
  await expect(
    runReleaseAction(fixture.env, { release, context: fakeContext(fixture.env) }),
  ).rejects.toThrow(/channel mismatch/i);
  expect(release).not.toHaveBeenCalled();
});

test("rejects another snap's same-source publication before resume", async () => {
  const fixture = await context({ ...state(), snap: "other-snap" });
  const release = vi.fn();
  await expect(
    runReleaseAction(fixture.env, { release, context: fakeContext(fixture.env) }),
  ).rejects.toThrow(/snap mismatch/i);
  expect(release).not.toHaveBeenCalled();
  await expect(
    access(join(fixture.env.GITHUB_WORKSPACE!, "manifest-amd64.yaml")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("records a fresh publication through the injected release boundary", async () => {
  const fixture = await context(state());
  await unlink(fixture.statePath);
  const manifestPath = join(fixture.env.GITHUB_WORKSPACE!, "manifest-amd64.yaml");
  const release = vi.fn(async (_input: ReleaseInput, dependencies: ReleaseDependencies) => {
    await dependencies.recordPublication(state());
    await dependencies.writeManifest(manifestPath, "manifest");
    return { published: state(), completedStages: ["publish"], manifestPath };
  });
  await runReleaseAction(fixture.env, { release, context: fakeContext(fixture.env) });
  expect(release).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(fixture.statePath, "utf8"))).toEqual(state());
  expect(await readFile(join(fixture.env.GITHUB_WORKSPACE!, "manifest-amd64.yaml"), "utf8")).toBe(
    "manifest",
  );
});

test("tags and removes only an exactly matching publication state", async () => {
  const fixture = await context(state());
  const recordTag = vi.fn();
  await runReleaseAction(
    {
      ...fixture.env,
      SNAPCRAFTERS_PHASE: "tag",
      INPUT_PUBLISHED_REVISION: "9007199254740993",
      INPUT_MULTI_SNAP: "false",
    },
    { recordTag, context: fakeContext(fixture.env) },
  );
  expect(recordTag.mock.calls[0]?.[0]).toMatchObject({
    name: "demo",
    revision: "9007199254740993",
    sourceSha: "a".repeat(40),
  });
  await expect(access(fixture.statePath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("rejects a tag revision mismatch before Git orchestration", async () => {
  const fixture = await context(state());
  const recordTag = vi.fn();
  await expect(
    runReleaseAction(
      {
        ...fixture.env,
        SNAPCRAFTERS_PHASE: "tag",
        INPUT_PUBLISHED_REVISION: "2",
      },
      { recordTag, context: fakeContext(fixture.env) },
    ),
  ).rejects.toThrow(/revision mismatch/i);
  expect(recordTag).not.toHaveBeenCalled();
});

function fakeContext(env: NodeJS.ProcessEnv) {
  return async () => ({
    workspace: env.GITHUB_WORKSPACE!,
    repository: env.GITHUB_REPOSITORY!,
    runId: env.GITHUB_RUN_ID!,
    sha: env.GITHUB_SHA!,
    eventName: env.GITHUB_EVENT_NAME!,
    event: {},
  });
}
