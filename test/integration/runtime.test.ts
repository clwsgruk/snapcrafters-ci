import { access, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { confinedPath, removeOwned } from "../../src/runtime/files.js";
import { runProcess } from "../../src/runtime/process.js";

describe("process boundary", () => {
  test("captures both streams and preserves the exit code in a precreated log", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci process space-"));
    const log = join(root, "complete.log");
    const result = await runProcess({
      file: "bash",
      args: ["--noprofile", "--norc", "-c", "printf first; printf second >&2; exit 7"],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      logPath: log,
    });
    expect(result).toMatchObject({ exitCode: 7, stdout: "first", stderr: "second" });
    expect(await readFile(log, "utf8")).toContain("first");
    expect(await readFile(log, "utf8")).toContain("second");
  });

  test("times out and terminates the owned process group", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-timeout-"));
    const result = await runProcess({
      file: "bash",
      args: ["--noprofile", "--norc", "-c", "sleep 30 & wait"],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 50,
      killAfterMs: 50,
      signal: new AbortController().signal,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("does not report success when a timed-out process handles TERM with exit zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-timeout-zero-"));
    const result = await runProcess({
      file: "bash",
      args: ["--noprofile", "--norc", "-c", "trap 'exit 0' TERM; while :; do sleep 1; done"],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 50,
      killAfterMs: 50,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ timedOut: true, exitCode: 124 });
  });

  test("does not spawn when already aborted and closes resources on spawn errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-preabort-"));
    const marker = join(root, "spawned");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runProcess({
        file: "bash",
        args: ["-c", `touch '${marker}'`],
        cwd: root,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 100,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
    await expect(access(marker)).rejects.toThrow();
    const signal = new AbortController().signal;
    await expect(
      runProcess({
        file: join(root, "missing"),
        args: [],
        cwd: root,
        env: {},
        timeoutMs: 100,
        signal,
      }),
    ).rejects.toThrow();
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });

  test("bounded KILL reaches a TERM-resistant grandchild even after parent exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-grandchild-"));
    const pidFile = join(root, "pid");
    const controller = new AbortController();
    const promise = runProcess({
      file: "bash",
      args: [
        "--noprofile",
        "--norc",
        "-c",
        `trap 'exit 0' TERM; (trap '' TERM; while :; do sleep 1; done) & echo $! > '${pidFile}'; wait`,
      ],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5_000,
      killAfterMs: 50,
      signal: controller.signal,
    });
    while (!(await readFile(pidFile, "utf8").catch(() => "")))
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await promise;
    await new Promise((resolve) => setTimeout(resolve, 80));
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(() => process.kill(pid, 0)).toThrow();
    expect(result.aborted).toBe(true);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("bounds and redacts returned output and the complete log", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-bounded-"));
    const log = join(root, "log");
    const result = await runProcess({
      file: "bash",
      args: ["-c", "printf secret; head -c 100000 /dev/zero | tr '\\0' x; printf secret >&2"],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      logPath: log,
      maxOutputBytes: 128,
      maxLogBytes: 256,
      redact: ["secret"],
    });
    expect(result.stdout).not.toContain("secret");
    expect(result.stderr).not.toContain("secret");
    const logged = await readFile(log, "utf8");
    expect(Buffer.byteLength(logged)).toBeLessThanOrEqual(256);
    expect(logged).not.toContain("secret");
    expect(logged).toContain("***");
  });

  test("redacts a secret crossing the truncation boundary before bounding output", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-redaction-boundary-"));
    const secret = "supersecretvalue";
    const result = await runProcess({
      file: "bash",
      args: ["-c", `printf '%0124d%s' 0 '${secret}'`],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      maxOutputBytes: 128,
      redact: [secret],
    });
    expect(result.stdout).toContain("***");
    expect(result.stdout).not.toContain("supe");
  });

  test("settles a log write failure and removes the abort listener", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-write-failure-"));
    const signal = new AbortController().signal;
    await expect(
      runProcess({
        file: "bash",
        args: ["--noprofile", "--norc", "-c", "printf output"],
        cwd: root,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 2_000,
        signal,
        logPath: "/dev/full",
      }),
    ).rejects.toThrow();
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
});

describe("filesystem boundary", () => {
  test("rejects traversal, absolute paths, and symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-root-"));
    const outside = await mkdtemp(join(tmpdir(), "ci-outside-"));
    await symlink(outside, join(root, "link"));
    await expect(confinedPath(root, "../escape")).rejects.toThrow(/traversal/i);
    await expect(confinedPath(root, join(outside, "absolute"))).rejects.toThrow(/absolute/i);
    await expect(confinedPath(root, "link/file")).rejects.toThrow(/symlink/i);
  });

  test("cleanup removes only a resource carrying the expected ownership marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "ci-owned-"));
    await writeFile(join(root, ".owner"), "run-1", { mode: 0o600 });
    await removeOwned(root, "run-1");
    await expect(readFile(root)).rejects.toThrow();
  });
});
