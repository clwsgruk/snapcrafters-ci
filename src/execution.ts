import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  openSync,
  closeSync,
  writeSync,
  appendFileSync,
  readSync,
  fstatSync,
  constants,
  rmSync,
} from "node:fs";
import { tmpdir, constants as osConstants } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { project } from "./project.ts";

export function safeEnv(env = process.env): NodeJS.ProcessEnv {
  const keys =
    /^(PATH|HOME|LANG|LC_ALL|TZ|CI|DISPLAY|XDG_RUNTIME_DIR|GITHUB_(WORKSPACE|SHA|REF|REF_NAME|REF_TYPE|REPOSITORY|REPOSITORY_OWNER|RUN_ID|RUN_NUMBER|RUN_ATTEMPT|JOB|ACTOR|EVENT_NAME|SERVER_URL|STEP_SUMMARY)|RUNNER_(OS|ARCH|TEMP))$/;
  return Object.fromEntries(
    Object.entries(env).filter(([k, v]) => keys.test(k) && v !== undefined),
  );
}

export function command(
  file: string,
  args: string[],
  cwd = process.cwd(),
  env = safeEnv(),
  timeout = 600_000,
): string {
  try {
    return execFileSync(file, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw Error(`${file} ${args[0] || ""} failed`);
  }
}

export async function script(
  source: string,
  directory: string,
  env = process.env,
  storage = tmpdir(),
) {
  const dir = mkdtempSync(join(storage, "script-"));
  const file = join(dir, "caller.sh");
  const stdout = join(dir, "stdout.log");
  const stderr = join(dir, "stderr.log");
  const callerSummary = join(dir, "caller-summary.md");
  writeFileSync(file, source, { mode: 0o600 });
  if (env.GITHUB_STEP_SUMMARY) {
    writeFileSync(callerSummary, "", { mode: 0o600, flag: "wx" });
  }

  const secrets = Object.entries(env)
    .filter(([k, v]) => /token|secret|password|credential/i.test(k) && v)
    .flatMap(([, v]) => [v!, ...v!.split(/\r?\n/)].filter(Boolean))
    .sort((a, b) => b.length - a.length);
  const redact = (s: string) =>
    secrets.reduce((v, secret) => v.replaceAll(secret, "***"), s).replaceAll("\u001b", "");
  const hold = secrets.reduce((n, secret) => Math.max(n, secret.length), 0);

  const first: string[] = [];
  const last: string[] = [];
  let live = 128 * 1024;

  const childEnv = safeEnv(env);
  if (env.GITHUB_STEP_SUMMARY) {
    childEnv.GITHUB_STEP_SUMMARY = callerSummary;
  }
  const child = spawn("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", file], {
    cwd: directory,
    env: childEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const streams = [child.stdout, child.stderr].map((stream, index) => {
    const fd = openSync(index ? stderr : stdout, "wx", 0o600);
    const decoder = new StringDecoder("utf8");
    let pending = "";

    const emit = (line: string) => {
      const text = redact(line).slice(0, 2000);
      if (first.length < 100) {
        first.push(text);
      } else {
        last.push(text);
        if (last.length > 100) {
          last.shift();
        }
      }

      if (live > 0) {
        const bytes = Buffer.from(redact(line));
        const part = bytes.subarray(0, live);
        process.stdout.write(part);
        live -= part.length;
      }
    };

    stream.on("data", (chunk: Buffer) => {
      writeSync(fd, chunk);
      pending += decoder.write(chunk);
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        emit(pending.slice(0, end + 1));
        pending = pending.slice(end + 1);
      }

      // Bound long unterminated lines while retaining any secret crossing the cut.
      if (pending.length > 65536 + hold) {
        let cut = 32768;
        for (const secret of secrets) {
          const pos = pending.lastIndexOf(secret, cut);
          if (pos >= 0 && pos + secret.length > cut) {
            cut = pos;
          }
        }
        if (cut > 0) {
          emit(pending.slice(0, cut));
          pending = pending.slice(cut);
        }
      }
    });

    return () => {
      pending += decoder.end();
      if (pending) {
        emit(pending);
      }
      closeSync(fd);
    };
  });

  const timer = setTimeout(
    () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* already exited */
      }
    },
    60 * 60 * 1000,
  );

  const code = await new Promise<number>((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (status, signal) =>
      resolve(status ?? 128 + (signal ? osConstants.signals[signal] : 0)),
    );
  });
  clearTimeout(timer);
  streams.forEach((finish) => finish());

  const short = (text: string, tail = false) => {
    const bytes = Buffer.from(text);
    return (tail ? bytes.subarray(-20000) : bytes.subarray(0, 20000))
      .toString("utf8")
      .replace(/^\uFFFD|\uFFFD$/g, "");
  };

  let extra = "";
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      const overlap = Math.max(0, ...secrets.map((secret) => Buffer.byteLength(secret)));
      const source = readBounded(callerSummary, 16000 + overlap, true);
      let boundary = Math.min(16000, source.length);
      for (const secret of secrets) {
        const bytes = Buffer.from(secret);
        let at = source.indexOf(bytes, Math.max(0, 16000 - bytes.length + 1));
        while (at >= 0 && at < 16000) {
          if (at + bytes.length > 16000) {
            boundary = Math.max(boundary, at + bytes.length);
          }
          at = source.indexOf(bytes, at + 1);
        }
      }

      const sanitized = redact(source.subarray(0, boundary).toString("utf8"));
      extra =
        "\nWorkflow summary:\n" +
        Buffer.from(sanitized)
          .subarray(0, 16000)
          .toString("utf8")
          .replace(/\uFFFD$/, "")
          .split("\n")
          .slice(0, 100)
          .join("\n");
    } catch {
      /* reporting cannot change the test result */
    }
  }

  const summary =
    short(first.join("")) + (last.length ? "\n…\n" + short(last.join(""), true) : "") + extra;
  try {
    writeFileSync(join(dir, "summary.txt"), summary, { mode: 0o600, flag: "wx" });
  } catch {
    console.warn("Could not save private test summary");
  }

  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    } catch {
      console.warn("Could not append test summary");
    }
  }

  return {
    code,
    script: file,
    stdout,
    stderr,
    summary,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function readBounded(file: string, limit: number, truncate = false): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (!truncate && stat.size > limit)) {
      throw Error("Invalid file type or size");
    }

    const bytes = Buffer.alloc(Math.min(stat.size, limit));
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) {
        break;
      }
      size += count;
    }

    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

export async function syncVersion(
  source: string,
  root: string,
  name: string,
  email: string,
  cwd = process.cwd(),
) {
  const before = project(root, cwd);
  const result = await script(source, cwd);
  try {
    result.cleanup();
  } catch {
    console.warn("Could not remove private update logs");
  }
  if (result.code) {
    throw Error(`Update script failed with status ${result.code}`);
  }

  const untracked = (
    command("git", ["ls-files", "--others", "-z"], cwd) +
    command("git", ["diff", "--name-only", "--no-renames", "--diff-filter=A", "HEAD", "-z"], cwd)
  )
    .split("\0")
    .filter(Boolean);
  if (untracked.length) {
    throw Error(`New paths must be resolved before committing:\n${untracked.join("\n")}`);
  }
  if (!command("git", ["status", "--porcelain", "--untracked-files=no"], cwd).trim()) {
    if (command("git", ["rev-list", "--count", "@{upstream}..HEAD"], cwd).trim() !== "0") {
      command("git", ["push"], cwd);
    }
    return;
  }

  const after = project(root, cwd);
  const detail =
    before.outputs.version === after.outputs.version
      ? "dependencies"
      : `to version ${after.outputs.version}`;
  command(
    "git",
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-am",
      `chore: bump ${after.outputs["snap-name"]} ${detail}`,
    ],
    cwd,
  );
  command("git", ["push"], cwd);
}
