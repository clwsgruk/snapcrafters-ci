import { spawn, execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { expect, test } from "vite-plus/test";
import { actions } from "../../scripts/actions.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const permittedUses = new Set([
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "canonical/setup-lxd@4e959f8e0d9c5feb27d44c5e4d9a330a782edee0",
  "snapcore/action-build@3bdaa03e1ba6bf59a65f84a751d943d549a54e79",
]);

test("all twelve copied composite wrappers execute real success paths under Node 24", async () => {
  const api = await localGitHub();
  try {
    const observed = new Map<string, string>();
    for (const action of actions) observed.set(action, await runWrapper(action, api.origin));
    expect([...observed.keys()].sort()).toEqual([...actions].sort());
    expect(observed.get("get-architectures")).toContain("architectures_list");
    expect(observed.get("get-screenshots")).toContain("ghvmctl:screenshot-window");
    expect(observed.get("promote-to-stable")).toMatch(/snapcraft:release demo (11|12)/);
    expect(observed.get("release-to-candidate")).toContain("snapcraft:upload");
    expect(observed.get("review-snap")).toContain("review:--allow-classic");
    expect(observed.get("test-snap-build")).toContain("--plugs");
    expect(api.writes).toBeGreaterThan(0);
  } finally {
    await api.close();
  }
}, 60_000);

test("all twelve bundles reject an invalid consumer context without the smoke bypass", async () => {
  const node = await pinnedNode();
  const sandbox = await mkdtemp(join(tmpdir(), "invalid-wrapper-context-"));
  const marker = join(sandbox, "unexpected-command");
  for (const command of ["sudo", "git", "snap", "snapcraft", "ghvmctl", "lxc"]) {
    await writeFile(
      join(sandbox, command),
      `#!/bin/bash\nprintf blocked > '${marker}'\nexit 123\n`,
      {
        mode: 0o700,
      },
    );
  }
  for (const action of actions) {
    const result = await execute(node, [resolve(action, "dist/index.cjs")], repositoryRoot, {
      PATH: sandbox,
      NODE_ENV: "production",
    });
    expect(result.code, action).not.toBe(0);
    await expect(
      readFile(marker),
      `${action} must reject before process orchestration`,
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
}, 60_000);

async function runWrapper(action: string, apiOrigin: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `wrapper-${action}-`));
  const workspace = join(root, "workspace");
  const actionPath = join(root, "action");
  const bin = join(root, "bin");
  const log = join(root, "observed.log");
  const output = join(root, "output");
  const eventPath = join(root, "event.json");
  await Promise.all([
    mkdir(workspace),
    mkdir(bin),
    cp(resolve(action), actionPath, { recursive: true }),
  ]);
  await mkdir(join(workspace, "snap"));
  await mkdir(join(workspace, ".github"));
  await writeFile(
    join(workspace, "snap/snapcraft.yaml"),
    "name: demo\nbase: core24\nversion: '1.0'\nconfinement: classic\nplatforms:\n  amd64:\n",
  );
  await writeFile(join(workspace, ".github/plug-declaration.json"), "{}");
  await writeFile(join(workspace, ".github/slot-declaration.json"), "{}");
  await writeFile(join(workspace, "tracked"), "old");
  await writeFile(output, "");
  await writeFile(eventPath, JSON.stringify(event(action)));
  await prepareGit(workspace);
  const sourceSha = (
    await execFile("git", ["rev-parse", "HEAD"], { cwd: workspace })
  ).stdout.trim();
  await fakeExecutables(bin, log, action);
  const node = await pinnedNode();
  if (action === "test-snap-build") await writeFile(join(workspace, "built.snap"), "snap");

  const metadata = parse(await readFile(join(actionPath, "action.yaml"), "utf8")) as {
    inputs?: Record<string, { default?: string; required?: boolean }>;
    runs: { steps: Array<{ uses?: string; run?: string; env?: Record<string, string> }> };
  };
  const inputs = Object.fromEntries(
    Object.entries(metadata.inputs ?? {}).map(([name, value]) => [
      name,
      String(value.default ?? ""),
    ]),
  );
  Object.assign(inputs, requiredInputs(action, workspace));
  const stepOutputs: Record<string, Record<string, string>> = {
    build: { snap: join(workspace, "built.snap") },
    publish: { revision: "44" },
  };
  let bundleSteps = 0;
  let runSteps = 0;
  for (const step of metadata.runs.steps) {
    if (step.uses) {
      expect(permittedUses.has(step.uses), `${action}: ${step.uses}`).toBe(true);
      continue;
    }
    if (!step.run) continue;
    runSteps++;
    if (step.run.includes("dist/index.cjs")) bundleSteps++;
    await writeFile(output, "");
    const env: Record<string, string> = {
      PATH: `${bin}:${dirname(node)}:${process.env.PATH ?? ""}`,
      NODE_ENV: "production",
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_API_URL: apiOrigin,
      GITHUB_GRAPHQL_URL: `${apiOrigin}/graphql`,
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "apps/demo",
      GITHUB_RUN_ID: "7",
      GITHUB_SHA: sourceSha,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: action === "promote-to-stable" ? "issue_comment" : "push",
      GITHUB_ACTION_PATH: actionPath,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_OS: "Linux",
      ImageOS: "ubuntu24",
    };
    for (const [name, value] of Object.entries(step.env ?? {}))
      env[name] = expression(String(value), inputs, stepOutputs);
    const runtime = await execute("node", ["-p", "process.versions.node"], workspace, env);
    expect(runtime.stdout.trim(), `${action} runtime`).toMatch(/^24\./);
    const command = step.run.replaceAll("${{ github.action_path }}", actionPath);
    const result = await execute(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", command],
      workspace,
      env,
    );
    expect(result.code, `${action}: ${result.stdout}\n${result.stderr}`).toBe(0);
  }
  expect(runSteps, `${action} executable wrapper steps`).toBeGreaterThanOrEqual(bundleSteps);
  expect(bundleSteps, action).toBe(action === "release-to-candidate" ? 2 : 1);
  return `${await readFile(log, "utf8").catch(() => "")}\n${await readFile(output, "utf8")}`;
}

async function pinnedNode(): Promise<string> {
  return (
    await execFile("/snap/mise/current/bin/mise", ["which", "node"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MISE_STATE_DIR: "/tmp/snapcrafters-mise-state",
        MISE_AUTO_INSTALL: "0",
      },
    })
  ).stdout.trim();
}

function requiredInputs(action: string, workspace: string): Record<string, string> {
  const common = { "github-token": "github-token-value", "store-token": "store-token-value" };
  switch (action) {
    case "call-for-testing":
      return { ...common, architectures: "amd64" };
    case "fetch-manifests":
      return { token: "artifact-token-value" };
    case "get-screenshots":
      return { ...common, "screenshots-token": "screenshots-token-value", "issue-number": "1" };
    case "promote-to-stable":
      return common;
    case "release-to-candidate":
      return {
        "launchpad-token": "launchpad-token-value",
        "repo-token": "repo-token-value",
        "store-token": "store-token-value",
      };
    case "review-snap":
      return { snap: join(workspace, "built.snap"), "is-classic": "true" };
    case "run-tests":
      return {
        "github-token": "github-token-value",
        "issue-number": "1",
        "test-script": "printf wrapper-test",
      };
    case "sync-version":
      return { token: "repo-token-value", "update-script": "printf new > tracked" };
    default:
      return {};
  }
}

function event(action: string): Record<string, unknown> {
  if (action !== "promote-to-stable") return {};
  return {
    action: "created",
    issue: { number: 1 },
    comment: {
      id: 9,
      body: "/promote 11,12 latest/stable done",
      user: { login: "maintainer" },
      created_at: "2026-09-06T10:00:00Z",
      updated_at: "2026-09-06T10:00:00Z",
    },
  };
}

function expression(
  value: string,
  inputs: Record<string, string>,
  outputs: Record<string, Record<string, string>>,
): string {
  const input = /^\$\{\{ inputs\.([a-z0-9-]+) \}\}$/.exec(value);
  if (input) return inputs[input[1]!] ?? "";
  const step = /^\$\{\{ steps\.([a-z0-9-]+)\.outputs\.([a-z0-9_-]+) \}\}$/.exec(value);
  if (step) return outputs[step[1]!]?.[step[2]!] ?? "";
  return value;
}

async function prepareGit(workspace: string): Promise<void> {
  const remote = join(workspace, "..", "remote.git");
  await execFile("git", ["init", "--bare", remote]);
  await execFile("git", ["init", "-b", "candidate"], { cwd: workspace });
  await execFile("git", ["config", "user.name", "seed"], { cwd: workspace });
  await execFile("git", ["config", "user.email", "seed@example.invalid"], { cwd: workspace });
  await execFile("git", ["add", "."], { cwd: workspace });
  await execFile("git", ["commit", "-m", "seed"], { cwd: workspace });
  await execFile("git", ["remote", "add", "origin", remote], { cwd: workspace });
  await execFile("git", ["push", "-u", "origin", "candidate"], { cwd: workspace });
}

async function fakeExecutables(bin: string, log: string, action: string): Promise<void> {
  const scripts: Record<string, string> = {
    sudo: `printf 'sudo:%s\\n' "$*" >> '${log}'\nexit 0`,
    snap: `printf 'snap:%s\\n' "$*" >> '${log}'\nexit 0`,
    dpkg: `printf amd64`,
    lxc: `printf 'lxc:%s\\n' "$*" >> '${log}'`,
    "review-tools.snap-review": `printf 'review:%s\\n' "$*" >> '${log}'`,
    unsquashfs: `printf "name: demo\\nversion: '1.0'\\narchitectures: [amd64]\\n"`,
    ghvmctl: `printf 'ghvmctl:%s\\n' "$*" >> '${log}'
mkdir -p "$SNAP_REAL_HOME/ghvmctl-screenshots"
case "$1" in
 screenshot-full) printf '\\211PNG\\r\\n\\032\\nscreen' > "$SNAP_REAL_HOME/ghvmctl-screenshots/screenshot-screen.png" ;;
 screenshot-window) printf '\\211PNG\\r\\n\\032\\nwindow' > "$SNAP_REAL_HOME/ghvmctl-screenshots/screenshot-window.png" ;;
esac`,
    snapcraft: snapcraftScript(log, action),
  };
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
    await chmod(path, 0o700);
  }
}

function snapcraftScript(log: string, action: string): string {
  const state = `${log}.store`;
  return `printf 'snapcraft:%s\\n' "$*" >> '${log}'
case "${action}:$1" in
 release-to-candidate:remote-build) printf 'fresh snap' > demo_1.0_amd64.snap ;;
 release-to-candidate:upload) touch '${state}-uploaded'; printf "Revision 44 created for 'demo' and released to 'latest/candidate'\\n" ;;
 release-to-candidate:revisions)
   printf 'Rev.    Uploaded              Arches    Version    Channels\\n'
   test -f '${state}-uploaded' && printf '44      2026-09-06T10:00:00Z  amd64     1.0        latest/candidate*\\n' || true ;;
 release-to-candidate:download) printf 'fresh snap' > demo_1.0_amd64.snap ;;
 call-for-testing:revisions) printf 'Rev.    Uploaded              Arches    Version    Channels\\n44      2026-09-06T10:00:00Z  amd64     1.0        latest/candidate*\\n' ;;
 promote-to-stable:revisions)
   printf 'Rev.    Uploaded              Arches    Version    Channels\\n'
   test -f '${state}-11' && printf '11      2026-09-06T10:00:00Z  amd64     1.0        latest/stable*\\n' || true
   test -f '${state}-12' && printf '12      2026-09-06T10:00:00Z  amd64     1.0        latest/stable*\\n' || true ;;
 promote-to-stable:release) touch '${state}-'$3 ;;
esac`;
}

async function execute(
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(file, args, { cwd, env, stdio: "pipe" });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (value) => resolveExit(value ?? 1));
  });
  return { code, stdout, stderr };
}

async function localGitHub(): Promise<{ origin: string; writes: number; close(): Promise<void> }> {
  let ref = "1".repeat(40);
  let issueClosed = false;
  const comments: Array<{ body: string }> = [];
  let writes = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.method !== "GET") writes++;
    if (url.pathname.endsWith("/actions/runs/7/artifacts"))
      return reply(200, { total_count: 0, artifacts: [] });
    if (url.pathname.endsWith("/collaborators/maintainer/permission"))
      return reply(200, { permission: "write" });
    if (url.pathname.endsWith("/issues/1/comments") && request.method === "GET")
      return reply(200, comments);
    if (url.pathname.endsWith("/issues/1/comments"))
      return collectJson(request, (body) => {
        comments.push({ body: String(body.body) });
        reply(201, { id: comments.length });
      });
    if (url.pathname.endsWith("/issues/comments/9/reactions")) return reply(201, { id: 1 });
    if (url.pathname.endsWith("/issues/1") && request.method === "GET")
      return reply(200, {
        number: 1,
        body: "A new version (1.0) of `demo` was just pushed to the `latest/candidate` channel. The following revisions are available.\n<table><thead><tr><th>CPU Architecture</th><th>Revision</th></tr></thead><tbody><tr><td>amd64</td><td>11</td></tr><tr><td>arm64</td><td>12</td></tr></tbody></table>\n/promote 11,12 latest/stable done",
        state: issueClosed ? "closed" : "open",
        labels: [{ name: "testing" }],
      });
    if (url.pathname.endsWith("/issues/1") && request.method === "PATCH") {
      issueClosed = true;
      return reply(200, { state: "closed" });
    }
    if (url.pathname.endsWith("/issues") && request.method === "GET") return reply(200, []);
    if (url.pathname.endsWith("/issues")) return reply(201, { number: 2 });
    if (
      url.pathname.endsWith("/git/ref/heads%2Fmain") ||
      url.pathname.endsWith("/git/ref/heads/main")
    )
      return reply(200, { object: { sha: ref } });
    if (/\/git\/commits\//.test(url.pathname))
      return reply(200, { tree: { sha: "2".repeat(40) } });
    if (url.pathname.endsWith("/git/blobs"))
      return reply(201, { sha: (writes % 2 ? "3" : "4").repeat(40) });
    if (url.pathname.endsWith("/git/trees")) return reply(201, { sha: "5".repeat(40) });
    if (url.pathname.endsWith("/git/commits")) return reply(201, { sha: "6".repeat(40) });
    if (url.pathname.endsWith("/git/refs/heads/main")) {
      ref = "6".repeat(40);
      return reply(200, { object: { sha: ref } });
    }
    if (/\/compare\//.test(url.pathname)) return reply(200, { status: "identical" });
    reply(404, { message: `unhandled ${request.method} ${url.pathname}` });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local server failed");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get writes() {
      return writes;
    },
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function collectJson(
  request: IncomingMessage,
  done: (body: Record<string, unknown>) => void,
): void {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () =>
    done(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>),
  );
}
