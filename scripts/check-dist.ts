import { builtinModules } from "node:module";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { actions } from "./actions.js";

const run = promisify(execFile);
const repository = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "snapcrafters-dist-check-"));
try {
  const node = await pinnedNode();
  const first = await copySourceTree(join(temporary, "source-a"));
  const second = await copySourceTree(join(temporary, "source-b"));
  const consumer = join(temporary, "consumer");
  await buildSource(first);
  await rm(resolve(first, "node_modules"), { recursive: true, force: true });
  await buildSource(second);
  await rm(resolve(second, "node_modules"), { recursive: true, force: true });
  const allowedRequires = new Set([
    ...builtinModules,
    ...builtinModules.map((item) => `node:${item}`),
  ]);
  const { stdout: version } = await run(node, ["-p", "process.versions.node"]);
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
    if (bundle.includes("SNAPCRAFTERS_CI_SMOKE"))
      throw new Error(`${action} contains a production smoke bypass`);
    const external = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)]
      .map((match) => match[1]!)
      .filter((name) => !allowedRequires.has(name));
    if (external.length)
      throw new Error(`${action} has external runtime requires: ${external.join(",")}`);
    const actionConsumer = resolve(consumer, action);
    await cp(resolve(action), actionConsumer, { recursive: true });
    await runNode(node, resolve(actionConsumer, "dist/index.cjs"), consumer, fakeBin);
  }
  console.log(`Verified ${actions.length} deterministic self-contained Node 24 action bundles`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function runNode(node: string, bundle: string, cwd: string, fakeBin: string): Promise<void> {
  const child = spawn(node, [bundle], {
    cwd,
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      NODE_ENV: "test",
    },
    stdio: "pipe",
  });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  if (exitCode === 0) throw new Error(`Bundle unexpectedly bypassed its workflow: ${bundle}`);
  if (!stdout && !stderr) throw new Error(`Bundle failure was not reported: ${bundle}`);
}

async function pinnedNode(): Promise<string> {
  const configuration = await readFile(resolve(repository, "mise.toml"), "utf8");
  const version = /^node = "([0-9]+\.[0-9]+\.[0-9]+)"$/m.exec(configuration)?.[1];
  if (!version) throw new Error("mise.toml has no exact Node pin");
  const data = process.env.MISE_DATA_DIR ?? resolve(homedir(), ".local/share/mise");
  const node = resolve(data, "installs", "node", version, "bin/node");
  await access(node, constants.X_OK);
  return node;
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
