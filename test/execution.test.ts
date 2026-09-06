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
    result.cleanup();
    expect(() => statSync(result.stdout)).toThrow();
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

test("sync rejects every untracked path before commit, and derives version after the script", async () => {
  const { syncVersion } = await import("../src/execution.ts");
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdirSync, chmodSync, unlinkSync } = await import("node:fs");
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
    writeFileSync(join(work, ".gitignore"), "ignored-output\n");
    git(["add", "snapcraft.yaml", ".gitignore"], work);
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
    await expect(
      syncVersion("printf ignored > ignored-output", "", "Bot", "bot@example.org", work),
    ).rejects.toThrow(/ignored-output/);
    expect(git(["rev-parse", "HEAD"], work)).toBe(head);
    rmSync(join(work, "ignored-output"));
    await expect(
      syncVersion(
        "printf staged > staged-file; git add staged-file",
        "",
        "Bot",
        "bot@example.org",
        work,
      ),
    ).rejects.toThrow(/staged-file/);
    expect(git(["rev-parse", "HEAD"], work)).toBe(head);
    git(["reset", "--", "staged-file"], work);
    rmSync(join(work, "staged-file"));
    const hook = join(remote, "hooks/pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o700);
    await expect(
      syncVersion("sed -i \"s/'1'/'2'/\" snapcraft.yaml", "", "Bot", "bot@example.org", work),
    ).rejects.toThrow(/git push failed/);
    expect(git(["log", "-1", "--format=%s"], work).trim()).toBe("chore: bump sample to version 2");
    expect(git(["rev-parse", "HEAD"], work)).not.toBe(
      git(["rev-parse", "refs/heads/candidate"], remote),
    );
    unlinkSync(hook);
    await syncVersion(":", "", "Bot", "bot@example.org", work);
    expect(git(["rev-parse", "HEAD"], work)).toBe(
      git(["rev-parse", "refs/heads/candidate"], remote),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("caller step-summary is included, bounded and redacted without changing the test status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "summary-")),
    file = join(dir, "summary");
  try {
    const result = await script(
      'printf "caller detail secret-token" > "$GITHUB_STEP_SUMMARY"; printf "output\\n"; exit 7',
      dir,
      {
        PATH: process.env.PATH,
        GITHUB_STEP_SUMMARY: file,
        INPUT_GITHUB_TOKEN: "secret-token",
      },
    );
    expect(result.code).toBe(7);
    expect(result.summary).toContain("caller detail ***");
    expect(result.summary).not.toContain("secret-token");
    expect(readFileSync(file, "utf8")).toContain("caller detail ***");
    expect(readFileSync(file, "utf8")).not.toContain("secret-token");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("multiline credential fragments never appear in live output or summary", async () => {
  const { vi } = await import("vitest");
  const output: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  try {
    const result = await script("printf 'header\\npayload\\nfooter\\n'", dir, {
      PATH: process.env.PATH,
      GITHUB_TOKEN: "header\npayload\nfooter",
    });
    expect(result.summary).not.toContain("payload");
    expect(output.join("")).not.toContain("payload");
    expect(readFileSync(result.stdout, "utf8")).toContain("payload");
  } finally {
    spy.mockRestore();
    rmSync(dir, { recursive: true });
  }
});

test("a signalled Bash script retains the conventional signal exit status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-"));
  try {
    expect((await script("kill -TERM $$", dir, { PATH: process.env.PATH })).code).toBe(143);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("private summary filesystem failure cannot replace the test exit status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "private-summary-"));
  try {
    const result = await script(
      'mkdir "${0%/*}/summary.txt"; exit 7',
      dir,
      { PATH: process.env.PATH },
      dir,
    );
    expect(result.code).toBe(7);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a credential longer than one stream chunk is redacted before any fragment is emitted", async () => {
  const { vi } = await import("vitest");
  const output: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  const dir = mkdtempSync(join(tmpdir(), "long-secret-")),
    secret = "sensitive".repeat(15000),
    raw = "prefix.".repeat(3000) + secret;
  try {
    const result = await script(
      `printf '${raw}'`,
      dir,
      { PATH: process.env.PATH, INPUT_TOKEN: secret },
      dir,
    );
    expect(output.join("").includes("sensitive")).toBe(false);
    expect(result.summary.includes("sensitive")).toBe(false);
    expect(readFileSync(result.stdout, "utf8")).toBe(raw);
  } finally {
    spy.mockRestore();
    rmSync(dir, { recursive: true });
  }
});
