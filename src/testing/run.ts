import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
      env: { PATH: process.env.PATH ?? "", GITHUB_STEP_SUMMARY: summaryPath },
      timeoutMs: 30 * 60_000,
      signal: input.signal ?? new AbortController().signal,
      logPath,
      maxOutputBytes: 2 * 1024 * 1024,
      maxLogBytes: 2 * 1024 * 1024,
    });
    const log = await readFile(logPath, "utf8");
    const summary = await readOptionalSummary(summaryPath);
    const commentBody = formatTestComment(result.exitCode, log, summary, input.runUrl);
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
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
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
  const summary = rawSummary.slice(0, 16_000).replaceAll("```", "`\u200b``");
  return `Automated testing ${exitCode === 0 ? "succeeded" : "failed"}.\n\nFull logs: ${runUrl}\n\n<details><summary>Logs</summary>\n\n\`\`\`\n${log}\n\`\`\`\n\n</details>${summary ? `\n\n<details><summary>Test summary</summary>\n\n${summary}\n\n</details>` : ""}`;
}
