import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { reviewArguments } from "../../src/review/run.js";
import { runTests } from "../../src/testing/run.js";
import { runUpdate } from "../../src/update/run.js";

const execFile = promisify(execFileCallback);

describe("tracked-only updates", () => {
  test("computes a version-bump commit message after the trusted update succeeds", async () => {
    const { repo } = await seededRepository();
    await writeFile(join(repo, "tracked"), "version: '1.0'\n");
    await execFile("git", ["add", "tracked"], { cwd: repo });
    await execFile("git", ["commit", "-m", "add version"], { cwd: repo });
    await execFile("git", ["push"], { cwd: repo });
    await runUpdate({
      cwd: repo,
      script: "printf \"version: '2.0'\\n\" > tracked",
      name: "bot",
      email: "bot@example.invalid",
      message: async () => {
        const source = await (
          await import("node:fs/promises")
        ).readFile(join(repo, "tracked"), "utf8");
        return `chore: bump to ${/version: '([^']+)'/.exec(source)?.[1]}`;
      },
    });
    expect(
      (await execFile("git", ["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim(),
    ).toBe("chore: bump to 2.0");
  });

  test("commits tracked modifications and rejects every untracked path", async () => {
    const repo = await mkdtemp(join(tmpdir(), "update repo-"));
    const remote = await mkdtemp(join(tmpdir(), "update remote-"));
    await execFile("git", ["init", "--bare", remote]);
    await execFile("git", ["init", "-b", "candidate"], { cwd: repo });
    await execFile("git", ["config", "user.name", "seed"], { cwd: repo });
    await execFile("git", ["config", "user.email", "seed@example.invalid"], { cwd: repo });
    await writeFile(join(repo, "tracked"), "old");
    await execFile("git", ["add", "tracked"], { cwd: repo });
    await execFile("git", ["commit", "-m", "seed"], { cwd: repo });
    await execFile("git", ["remote", "add", "origin", remote], { cwd: repo });
    await execFile("git", ["push", "-u", "origin", "candidate"], { cwd: repo });

    await expect(
      runUpdate({
        cwd: repo,
        script: "printf new > tracked\nprintf nope > untracked",
        name: "bot",
        email: "bot@example.invalid",
        message: "chore: update",
      }),
    ).rejects.toThrow(/untracked/);
    expect(
      (await execFile("git", ["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim(),
    ).toBe("seed");
  });

  test("honours a pre-aborted caller signal before trusted Bash starts", async () => {
    const repo = await mkdtemp(join(tmpdir(), "update-abort-"));
    const marker = join(repo, "must-not-exist");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runUpdate({
        cwd: repo,
        script: `printf bad > '${marker}'`,
        name: "bot",
        email: "bot@example.invalid",
        message: "chore: update",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("pushes tracked modifications and deletions but treats no changes as a no-op", async () => {
    const { repo, remote } = await seededRepository();
    const result = await runUpdate({
      cwd: repo,
      script: "printf new > tracked\nrm obsolete",
      name: "bot",
      email: "bot@example.invalid",
      message: "chore: update tracked files",
    });
    expect(result.changed).toBe(true);
    expect(
      (await execFile("git", ["--git-dir", remote, "show", "candidate:tracked"])).stdout,
    ).toBe("new");
    await expect(
      execFile("git", ["--git-dir", remote, "show", "candidate:obsolete"]),
    ).rejects.toThrow();
    await expect(
      runUpdate({
        cwd: repo,
        script: "true",
        name: "bot",
        email: "bot@example.invalid",
        message: "unused",
      }),
    ).resolves.toEqual({ changed: false });
  });

  test("preserves script failure and exposes a rejected push after the local commit", async () => {
    const { repo, remote } = await seededRepository();
    await expect(
      runUpdate({
        cwd: repo,
        script: "printf bad >&2\nexit 23",
        name: "bot",
        email: "bot@example.invalid",
        message: "must not commit",
      }),
    ).rejects.toThrow(/bash failed \(23\).*bad/s);
    expect(
      (await execFile("git", ["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim(),
    ).toBe("seed");
    await writeFile(join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await expect(
      runUpdate({
        cwd: repo,
        script: "printf changed > tracked",
        name: "bot",
        email: "bot@example.invalid",
        message: "chore: locally committed",
      }),
    ).rejects.toThrow(/git failed/i);
    expect(
      (await execFile("git", ["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim(),
    ).toBe("chore: locally committed");
    expect(
      (await execFile("git", ["--git-dir", remote, "show", "candidate:tracked"])).stdout,
    ).toBe("old");
  });

  test("rejects an untracked-only update before commit", async () => {
    const { repo } = await seededRepository();
    await expect(
      runUpdate({
        cwd: repo,
        script: "printf new > untracked-only",
        name: "bot",
        email: "bot@example.invalid",
        message: "must not commit",
      }),
    ).rejects.toThrow(/untracked-only/);
    expect(
      (await execFile("git", ["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim(),
    ).toBe("seed");
  });
});

async function seededRepository(): Promise<{ repo: string; remote: string }> {
  const repo = await mkdtemp(join(tmpdir(), "update seeded repo-"));
  const remote = await mkdtemp(join(tmpdir(), "update seeded remote-"));
  await execFile("git", ["init", "--bare", remote]);
  await execFile("git", ["init", "-b", "candidate"], { cwd: repo });
  await execFile("git", ["config", "user.name", "seed"], { cwd: repo });
  await execFile("git", ["config", "user.email", "seed@example.invalid"], { cwd: repo });
  await writeFile(join(repo, "tracked"), "old");
  await writeFile(join(repo, "obsolete"), "remove me");
  await execFile("git", ["add", "tracked", "obsolete"], { cwd: repo });
  await execFile("git", ["commit", "-m", "seed"], { cwd: repo });
  await execFile("git", ["remote", "add", "origin", remote], { cwd: repo });
  await execFile("git", ["push", "-u", "origin", "candidate"], { cwd: repo });
  return { repo, remote };
}

describe("review command", () => {
  test("uses argument arrays for optional declarations and classic mode", () => {
    expect(
      reviewArguments({
        snap: "--hostile snap.snap",
        plugs: "p file",
        slots: "s file",
        classic: true,
      }),
    ).toEqual([
      "--plugs",
      "p file",
      "--slots",
      "s file",
      "--allow-classic",
      "--hostile snap.snap",
    ]);
  });
});

describe("trusted test runner", () => {
  test("captures multiline early failure and summary while comment errors do not replace result", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tests-"));
    const result = await runTests(
      {
        cwd,
        script:
          "printf 'first\\n'\nprintf 'summary' > \"$GITHUB_STEP_SUMMARY\"\nprintf 'bad\\n' >&2\nfalse\nprintf never",
        runUrl: "https://github.test/run",
      },
      {
        comment: async () => {
          throw new Error("report failed");
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.log).toContain("first");
    expect(result.log).toContain("bad");
    expect(result.commentError?.message).toBe("report failed");
    expect(result.commentBody).toContain("summary");
  });

  test("missing summary is a no-op and scratch files are cleaned", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tests-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "tests-scratch-root-"));
    const result = await runTests(
      {
        cwd,
        script: 'rm -- "$GITHUB_STEP_SUMMARY"\nprintf ok',
        runUrl: "https://github.test/run",
        tempRoot,
      },
      { comment: async () => undefined },
    );
    expect(result.exitCode).toBe(0);
    expect(result.commentBody).not.toContain("Test summary");
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test("honours cancellation before running a private test script", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tests-"));
    const marker = join(cwd, "must-not-exist");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTests(
        {
          cwd,
          script: `printf bad > '${marker}'`,
          runUrl: "https://github.test/run",
          signal: controller.signal,
        },
        { comment: async () => undefined },
      ),
    ).rejects.toThrow(/abort/i);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("bounds oversized logs and escapes embedded code fences", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tests-"));
    const result = await runTests(
      {
        cwd,
        script: "for i in {1..400}; do printf 'line %s ```\\n' \"$i\"; done",
        runUrl: "https://github.test/run",
      },
      { comment: async () => undefined },
    );
    expect(result.exitCode).toBe(0);
    expect(result.commentBody.length).toBeLessThan(30_000);
    expect(result.commentBody).toContain("Logs truncated");
    expect(result.commentBody).not.toContain("line 1 ```");
  });
});
