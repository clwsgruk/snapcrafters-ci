import { spawn } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";

export interface ProcessSpec {
  file: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  logPath?: string;
  killAfterMs?: number;
  maxOutputBytes?: number;
  maxLogBytes?: number;
  redact?: readonly string[];
  streamOutput?: boolean;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  if (!spec.file || spec.file.includes("\n")) throw new Error("Invalid executable");
  if (spec.signal.aborted) throw new Error("Process aborted before spawn");
  let log: FileHandle | undefined;
  if (spec.logPath) {
    log = await open(spec.logPath, "w", 0o600);
    await log.chmod(0o600);
  }
  if (spec.signal.aborted) {
    await log?.close();
    throw new Error("Process aborted before spawn");
  }

  const outputLimit = spec.maxOutputBytes ?? 1024 * 1024;
  const logLimit = spec.maxLogBytes ?? 10 * 1024 * 1024;
  const redactionMargin = Math.max(
    0,
    ...(spec.redact ?? []).map((item) => Buffer.byteLength(item)),
  );
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let combined: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let timedOut = false;
  let aborted = false;
  let terminationStarted = false;
  let killTimer: NodeJS.Timeout | undefined;
  let finishKill: (() => void) | undefined;
  const killComplete = new Promise<void>((resolve) => {
    finishKill = resolve;
  });
  let child;
  try {
    child = spawn(spec.file, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await log?.close();
    throw error;
  }
  const append = (kind: "stdout" | "stderr", chunk: Buffer) => {
    if (kind === "stdout") stdout = boundedAppend(stdout, chunk, outputLimit + redactionMargin);
    else stderr = boundedAppend(stderr, chunk, outputLimit + redactionMargin);
    combined = boundedAppend(combined, chunk, logLimit + redactionMargin);
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const terminate = (reason: "timeout" | "abort") => {
    if (terminationStarted) return;
    terminationStarted = true;
    timedOut = reason === "timeout";
    aborted = reason === "abort";
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => {
      signalGroup("SIGKILL");
      finishKill?.();
    }, spec.killAfterMs ?? 1_000);
  };
  const abortListener = () => terminate("abort");
  spec.signal.addEventListener("abort", abortListener, { once: true });
  const timeout = setTimeout(() => terminate("timeout"), spec.timeoutMs);

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
    if (terminationStarted) await killComplete;
    else finishKill?.();
    const cleanStdout = redactAndBound(stdout, spec.redact ?? [], outputLimit);
    const cleanStderr = redactAndBound(stderr, spec.redact ?? [], outputLimit);
    const cleanLog = Buffer.from(redactAndBound(combined, spec.redact ?? [], logLimit));
    if (spec.streamOutput) {
      process.stdout.write(cleanStdout);
      process.stderr.write(cleanStderr);
    }
    if (log) await log.writeFile(cleanLog);
    return {
      exitCode: timedOut ? 124 : aborted ? 130 : exitCode,
      stdout: cleanStdout,
      stderr: cleanStderr,
      timedOut,
      aborted,
    };
  } finally {
    clearTimeout(timeout);
    if (killTimer && !terminationStarted) clearTimeout(killTimer);
    spec.signal.removeEventListener("abort", abortListener);
    await log?.close();
  }
}

function boundedAppend(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  limit: number,
): Buffer<ArrayBufferLike> {
  if (current.length >= limit) return current;
  return Buffer.concat([current, chunk.subarray(0, limit - current.length)]);
}

function redact(value: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((text, secret) => text.replaceAll(secret, "***"), value);
}

function redactAndBound(
  value: Buffer<ArrayBufferLike>,
  secrets: readonly string[],
  limit: number,
): string {
  return Buffer.from(redact(value.toString(), secrets)).subarray(0, limit).toString();
}
