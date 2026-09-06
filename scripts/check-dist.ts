import { builtinModules } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { actions } from "./actions.js";
import { buildAll } from "./build.js";

const first = await mkdtemp(join(tmpdir(), "snapcrafters-dist-a-"));
const second = await mkdtemp(join(tmpdir(), "snapcrafters-dist-b-"));
const consumer = await mkdtemp(join(tmpdir(), "snapcrafters-consumer-"));
await buildAll(first);
await buildAll(second);
const allowedRequires = new Set([
  ...builtinModules,
  ...builtinModules.map((item) => `node:${item}`),
]);
for (const action of actions) {
  const expected = ["index.cjs", "licenses.txt"];
  const committed = resolve(action, "dist");
  const actual = (await readdir(committed)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Unexpected dist manifest for ${action}: ${actual.join(",")}`);
  for (const file of expected) {
    const hashes = await Promise.all(
      [
        resolve(first, action, "dist", file),
        resolve(second, action, "dist", file),
        resolve(committed, file),
      ].map(async (path) =>
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ),
    );
    if (new Set(hashes).size !== 1)
      throw new Error(`Non-deterministic or stale bundle: ${action}/dist/${file}`);
  }
  const bundle = await readFile(resolve(committed, "index.cjs"), "utf8");
  const external = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)]
    .map((match) => match[1]!)
    .filter((name) => !allowedRequires.has(name));
  if (external.length)
    throw new Error(`${action} has external runtime requires: ${external.join(",")}`);
  const actionConsumer = resolve(consumer, action);
  await cp(committed, actionConsumer, { recursive: true });
  await runNode(resolve(actionConsumer, "index.cjs"), consumer);
}
console.log(`Verified ${actions.length} deterministic self-contained Node 24 action bundles`);

async function runNode(bundle: string, cwd: string): Promise<void> {
  const child = spawn(process.execPath, [bundle], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      SNAPCRAFTERS_CI_SMOKE: "1",
    },
    stdio: "pipe",
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`Consumer smoke failed (${exitCode}): ${stderr}`);
}
