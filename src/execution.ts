import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  openSync,
  closeSync,
  writeSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

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
  const file = join(dir, "caller.sh"),
    stdout = join(dir, "stdout.log"),
    stderr = join(dir, "stderr.log");
  writeFileSync(file, source, { mode: 0o600 });
  const secrets = Object.entries(env)
    .filter(([k, v]) => /token|secret|password|credential/i.test(k) && v)
    .map(([, v]) => v!)
    .sort((a, b) => b.length - a.length);
  const redact = (s: string) =>
    secrets.reduce((v, secret) => v.replaceAll(secret, "***"), s).replaceAll("\u001b", "");
  const first: string[] = [],
    last: string[] = [];
  let live = 128 * 1024;
  const child = spawn("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", file], {
    cwd: directory,
    env: safeEnv(env),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const streams = [child.stdout, child.stderr].map((stream, index) => {
    const fd = openSync(index ? stderr : stdout, "wx", 0o600),
      decoder = new StringDecoder("utf8");
    let pending = "";
    const emit = (line: string) => {
      const text = redact(line).slice(0, 2000);
      if (first.length < 100) first.push(text);
      else {
        last.push(text);
        if (last.length > 100) last.shift();
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
      if (pending.length > 65536) {
        let cut = 32768;
        for (const secret of secrets) {
          const pos = pending.lastIndexOf(secret, cut);
          if (pos >= 0 && pos + secret.length > cut) cut = pos;
        }
        if (cut > 0) {
          emit(pending.slice(0, cut));
          pending = pending.slice(cut);
        }
      }
    });
    return () => {
      pending += decoder.end();
      if (pending) emit(pending);
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
    child.once("close", (status) => resolve(status ?? 128));
  });
  clearTimeout(timer);
  streams.forEach((finish) => finish());
  const summary = Buffer.from([...first, ...(last.length ? ["\n…\n", ...last] : [])].join(""))
    .subarray(0, 60000)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
  writeFileSync(join(dir, "summary.txt"), summary, { mode: 0o600 });
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    } catch {
      console.warn("Could not append test summary");
    }
  }
  return { code, script: file, stdout, stderr, summary };
}
