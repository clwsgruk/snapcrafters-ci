import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { script } from "../src/execution.ts";
test("one trusted Bash script preserves both streams, failure status, private logs and safe workflow env", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "script-"));
  try {
    const source =
      'printf "first\\n"\nprintf "stderr\\n" >&2\nprintf "%s:%s\\n" "$GITHUB_SHA" "${GITHUB_TOKEN-unset}"\nfalse | true\nprintf "unreachable\\n"\n';
    const result = await script(source, cwd, {
      PATH: process.env.PATH,
      GITHUB_SHA: "abc",
      GITHUB_TOKEN: "secret",
    });
    expect(result.code).toBe(1);
    expect(readFileSync(result.script, "utf8")).toBe(source);
    expect(readFileSync(result.stdout, "utf8")).toBe("first\nabc:unset\n");
    expect(readFileSync(result.stderr, "utf8")).toBe("stderr\n");
    expect(statSync(result.stdout).mode & 0o777).toBe(0o600);
    expect(result.summary).toContain("first");
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

test("sync rejects every untracked path before commit, and derives version after the script", async () => {
  const { syncVersion } = await import("../src/local.ts");
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const git = (args: string[], cwd = dir) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const remote = join(dir, "remote.git"),
      work = join(dir, "work");
    git(["init", "--bare", remote]);
    mkdirSync(work);
    git(["init", "-b", "candidate"], work);
    writeFileSync(join(work, "snapcraft.yaml"), "name: sample\nversion: '1'\n");
    git(["add", "snapcraft.yaml"], work);
    const identity = [
      "-c",
      "user.name=Tester",
      "-c",
      "user.email=test@example.org",
      "-c",
      "commit.gpgsign=false",
    ];
    git([...identity, "commit", "-m", "initial"], work);
    git(["remote", "add", "origin", remote], work);
    git(["push", "-u", "origin", "candidate"], work);
    const head = git(["rev-parse", "HEAD"], work);
    await expect(
      syncVersion("printf untracked > 'new file'", "", "Bot", "bot@example.org", work),
    ).rejects.toThrow(/new file/);
    expect(git(["rev-parse", "HEAD"], work)).toBe(head);
    rmSync(join(work, "new file"));
    await syncVersion("sed -i \"s/'1'/'2'/\" snapcraft.yaml", "", "Bot", "bot@example.org", work);
    expect(git(["log", "-1", "--format=%s"], work).trim()).toBe("chore: bump sample to version 2");
    expect(git(["rev-parse", "HEAD"], work)).toBe(
      git(["rev-parse", "refs/heads/candidate"], remote),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("caller step-summary is included, bounded and redacted without changing the test status", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "summary-")),
    file = join(dir, "summary");
  writeFileSync(file, "caller detail secret-token");
  try {
    const result = await script('printf "output\\n"; exit 7', dir, {
      PATH: process.env.PATH,
      GITHUB_STEP_SUMMARY: file,
      INPUT_GITHUB_TOKEN: "secret-token",
    });
    expect(result.code).toBe(7);
    expect(result.summary).toContain("caller detail ***");
    expect(result.summary).not.toContain("secret-token");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
