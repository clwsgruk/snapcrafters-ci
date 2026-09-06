import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { expect, test } from "vite-plus/test";
import { actions } from "../../scripts/actions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const permittedUses = new Set([
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "canonical/setup-lxd@4e959f8e0d9c5feb27d44c5e4d9a330a782edee0",
  "snapcore/action-build@3bdaa03e1ba6bf59a65f84a751d943d549a54e79",
]);

test("all twelve composite wrappers execute their own bundles from a consumer checkout", async () => {
  const consumer = await mkdtemp(join(tmpdir(), "snapcrafters-wrapper-consumer-"));
  const invoked = new Map<string, number>();
  for (const action of actions) {
    const actionPath = resolve(root, action);
    const metadata = parse(await readFile(resolve(actionPath, "action.yaml"), "utf8")) as {
      inputs?: Record<string, unknown>;
      runs: { steps: Array<{ uses?: string; run?: string; env?: Record<string, string> }> };
    };
    for (const step of metadata.runs.steps) {
      if (step.uses) {
        expect(permittedUses.has(step.uses), `${action}: ${step.uses}`).toBe(true);
        continue;
      }
      if (!step.run?.includes("dist/index.cjs")) continue;
      const command = step.run.replaceAll("${{ github.action_path }}", actionPath);
      const environment: Record<string, string> = {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        SNAPCRAFTERS_CI_SMOKE: "1",
      };
      for (const [name, value] of Object.entries(step.env ?? {})) {
        const input = /^\$\{\{ inputs\.([a-z0-9-]+) \}\}$/.exec(String(value));
        environment[name] = input ? `smoke-${input[1]}` : "smoke";
      }
      await execute(command, consumer, environment);
      invoked.set(action, (invoked.get(action) ?? 0) + 1);
    }
  }
  expect([...invoked.keys()].sort()).toEqual([...actions].sort());
  expect(invoked.get("release-to-candidate")).toBe(2);
});

async function execute(command: string, cwd: string, env: Record<string, string>): Promise<void> {
  const child = spawn("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", command], {
    cwd,
    env,
    stdio: "pipe",
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (value) => resolveExit(value ?? 1));
  });
  if (code !== 0) throw new Error(`Wrapper bundle failed (${code}): ${stderr}`);
}
