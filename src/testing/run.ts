import { randomUUID } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedTemp, removeOwned } from "../runtime/files.js";
import { runProcess } from "../runtime/process.js";

export interface TestRunInput {
  cwd: string;
  script: string;
  runUrl: string;
  signal?: AbortSignal;
  tempRoot?: string;
  deliveryMarker?: string;
}

export interface TestRunResult {
  exitCode: number;
  logPath: string;
  log: string;
  commentBody: string;
  commentError?: Error;
}

export async function runTests(
  input: TestRunInput,
  deps: { comment(body: string): Promise<void> },
): Promise<TestRunResult> {
  const owner = `tests-${randomUUID()}`;
  const scratch = await ownedTemp(input.tempRoot ?? tmpdir(), "snapcrafters-tests-", owner);
  const scriptPath = join(scratch, "test.sh");
  const logPath = join(scratch, "complete.log");
  const summaryPath = join(scratch, "summary.md");
  try {
    await writeFile(scriptPath, input.script, { mode: 0o600 });
    await writeFile(logPath, "", { mode: 0o600 });
    await writeFile(summaryPath, "", { mode: 0o600 });
    const result = await runProcess({
      file: "bash",
      args: ["--noprofile", "--norc", "-e", "-o", "pipefail", scriptPath],
      cwd: input.cwd,
      env: safeTestEnvironment(summaryPath),
      timeoutMs: 30 * 60_000,
      signal: input.signal ?? new AbortController().signal,
      logPath,
      maxOutputBytes: 10 * 1024 * 1024,
      maxLogBytes: 10 * 1024 * 1024,
      streamOutput: true,
    });
    const log = await readFile(logPath, "utf8");
    const summary = await readOptionalSummary(summaryPath);
    if (
      input.deliveryMarker &&
      !/^<!-- snapcrafters-ci:test:[1-9][0-9]*:[0-9a-f]{40} -->$/.test(input.deliveryMarker)
    )
      throw new Error("Invalid test report delivery marker");
    const formatted = formatTestComment(result.exitCode, log, summary, input.runUrl);
    const commentBody = input.deliveryMarker
      ? `${formatted}\n\n${input.deliveryMarker}`
      : formatted;
    let commentError: Error | undefined;
    try {
      await deps.comment(commentBody);
    } catch (error) {
      commentError = error instanceof Error ? error : new Error(String(error));
    }
    return {
      exitCode: result.exitCode,
      logPath,
      log,
      commentBody,
      ...(commentError ? { commentError } : {}),
    };
  } finally {
    await removeOwned(scratch, owner);
  }
}

async function readOptionalSummary(path: string): Promise<string> {
  const limit = 16_000;
  try {
    const handle = await open(path, "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size === 0) return "";
      const buffer = Buffer.alloc(Math.min(metadata.size, limit + 4));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const value = buffer.subarray(0, bytesRead).toString("utf8").replace(/�$/, "");
      return bytesRead > limit || metadata.size > limit
        ? truncateUtf8(value, limit, "\n\n(Summary truncated.)")
        : value;
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function safeTestEnvironment(summaryPath: string): Record<string, string> {
  const rejected = /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY)/i;
  const dangerous = new Set([
    "BASH_ENV",
    "ENV",
    "SHELLOPTS",
    "CDPATH",
    "GLOBIGNORE",
    "LD_PRELOAD",
  ]);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value === undefined ||
      rejected.test(name) ||
      name.startsWith("INPUT_") ||
      dangerous.has(name)
    )
      continue;
    env[name] = value;
  }
  env.PATH = process.env.PATH ?? "";
  env.GITHUB_STEP_SUMMARY = summaryPath;
  return env;
}

export function formatTestComment(
  exitCode: number,
  rawLog: string,
  rawSummary: string,
  runUrl: string,
): string {
  const lines = rawLog.split("\n");
  const truncated = lines.length > 250 || Buffer.byteLength(rawLog) > 24_000;
  const selected = truncated
    ? [
        ...lines.slice(0, 100),
        "",
        `(Logs truncated. See full logs at: ${runUrl})`,
        "",
        ...lines.slice(-100),
      ]
    : lines;
  const log = selected.join("\n").slice(0, 24_000).replaceAll("```", "`\u200b``");
  const summary = truncateUtf8(rawSummary, 16_000, "\n\n(Summary truncated.)").replaceAll(
    "```",
    "`\u200b``",
  );
  return `Automated testing ${exitCode === 0 ? "succeeded" : "failed"}.\n\nFull logs: ${runUrl}\n\n<details><summary>Logs</summary>\n\n\`\`\`\n${log}\n\`\`\`\n\n</details>${summary ? `\n\n<details><summary>Test summary</summary>\n\n${summary}\n\n</details>` : ""}`;
}

function truncateUtf8(value: string, limit: number, marker = ""): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  const target = limit - Buffer.byteLength(marker);
  let end = target;
  let result = bytes.subarray(0, end).toString("utf8");
  while (Buffer.byteLength(result) > target || result.endsWith("�"))
    result = bytes.subarray(0, --end).toString("utf8");
  return `${result}${marker}`;
}
