import { builtinModules } from "node:module";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { actions } from "./actions.js";

const run = promisify(execFile);
const repository = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "snapcrafters-dist-check-"));
try {
  const first = await copySourceTree(join(temporary, "source-a"));
  const second = await copySourceTree(join(temporary, "source-b"));
  const consumer = join(temporary, "consumer");
  await Promise.all([buildSource(first), buildSource(second)]);
  const allowedRequires = new Set([
    ...builtinModules,
    ...builtinModules.map((item) => `node:${item}`),
  ]);
  const { stdout: version } = await run("node", ["-p", "process.versions.node"]);
  if (!version.trim().startsWith("24."))
    throw new Error(`Expected Node 24, received ${version.trim()}`);
  const fakeBin = join(temporary, "bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "sudo"), "#!/bin/sh\nexit 17\n", { mode: 0o700 });
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
    await cp(resolve(action), actionConsumer, { recursive: true });
    await runNode(resolve(actionConsumer, "dist/index.cjs"), consumer, fakeBin);
  }
  console.log(`Verified ${actions.length} deterministic self-contained Node 24 action bundles`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function runNode(bundle: string, cwd: string, fakeBin: string): Promise<void> {
  const child = spawn("node", [bundle], {
    cwd,
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      NODE_ENV: "production",
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
  if (exitCode === 0) throw new Error(`Bundle unexpectedly bypassed its workflow: ${bundle}`);
  if (!stderr) throw new Error(`Bundle failure was not reported: ${bundle}`);
}

async function copySourceTree(destination: string): Promise<string> {
  const { stdout } = await run("git", ["ls-files", "-z"], { cwd: repository, encoding: "buffer" });
  const files = stdout.toString().split("\0").filter(Boolean);
  for (const file of files) {
    const target = resolve(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(repository, file), target);
  }
  return destination;
}

async function buildSource(source: string): Promise<void> {
  await run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: source });
  await run("bun", ["scripts/build.ts"], { cwd: source });
}
