import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const root = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const generated = tracked.filter((p) => /\/dist\/(index\.cjs|licenses\.txt)$/.test(p));
if (generated.length !== 24) {
  throw Error("Expected 12 bundles and 12 license notices");
}

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const expected = new Map(
  generated.map((path) => {
    const committed = execFileSync("git", ["show", `HEAD:${path}`], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return [path, hash(committed)];
  }),
);

for (const file of tracked.filter((p) => /^(src\/|[^/]+\/main\.ts$)/.test(p))) {
  if (
    /process\.env\.(NODE_ENV|CI_SMOKE|TEST_MODE)|smoke.?bypass/i.test(readFileSync(file, "utf8"))
  ) {
    throw Error(`Production bypass: ${file}`);
  }
}

for (let copy = 0; copy < 2; copy++) {
  const dir = mkdtempSync(join(tmpdir(), "ci-dist-"));
  try {
    for (const file of tracked.filter((p) => !p.includes("/dist/"))) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(resolve(root, file), join(dir, file));
    }

    execFileSync("bun", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "pipe" });
    execFileSync("bun", ["scripts/build.ts"], { cwd: dir, stdio: "pipe" });

    for (const file of generated) {
      if (
        hash(readFileSync(join(dir, file))) !== expected.get(file) ||
        hash(readFileSync(resolve(root, file))) !== expected.get(file)
      ) {
        throw Error(`Generated drift: ${file}`);
      }
    }

    rmSync(join(dir, "node_modules"), { recursive: true });
    const consumer = join(dir, "consumer");
    mkdirSync(consumer);
    const out = join(consumer, "outputs");
    writeFileSync(join(consumer, "snapcraft.yaml"), "name: copied-sample\nversion: '1'\n");
    execFileSync(process.execPath, [join(dir, "parse-snapcraft-yaml/dist/index.cjs")], {
      cwd: consumer,
      env: {
        GITHUB_SERVER_URL: "https://github.com",
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_OS: "Linux",
        ImageOS: "ubuntu24",
        CI_PHASE: "run",
        GITHUB_OUTPUT: out,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(
  `Two independent frozen builds match all ${generated.length} committed artifacts; Node ${process.version}`,
);
