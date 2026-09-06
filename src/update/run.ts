import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedTemp, removeOwned } from "../runtime/files.js";
import { runProcess } from "../runtime/process.js";

export interface UpdateInput {
  cwd: string;
  script: string;
  name: string;
  email: string;
  message: string | (() => Promise<string>);
  signal?: AbortSignal;
  tempRoot?: string;
}

export async function runUpdate(input: UpdateInput): Promise<{ changed: boolean }> {
  const owner = `update-${randomUUID()}`;
  const scratch = await ownedTemp(input.tempRoot ?? tmpdir(), "snapcrafters-update-", owner);
  const script = join(scratch, "update.sh");
  const signal = input.signal ?? new AbortController().signal;
  try {
    await writeFile(script, input.script, { mode: 0o600 });
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? input.cwd };
    await successful(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", script],
      input.cwd,
      env,
      signal,
    );
    const status = await successful(
      "git",
      ["status", "--porcelain=v1", "-z"],
      input.cwd,
      env,
      signal,
    );
    const records = status.stdout.split("\0").filter(Boolean);
    const untracked = records
      .filter((record) => record.startsWith("?? "))
      .map((record) => record.slice(3));
    if (untracked.length)
      throw new Error(`Update created untracked paths: ${untracked.join(", ")}`);
    if (records.length === 0) return { changed: false };
    const message = typeof input.message === "string" ? input.message : await input.message();
    await successful("git", ["add", "-u"], input.cwd, env, signal);
    await successful(
      "git",
      [
        "-c",
        `user.name=${input.name}`,
        "-c",
        `user.email=${input.email}`,
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        message,
      ],
      input.cwd,
      env,
      signal,
    );
    await successful("git", ["push"], input.cwd, env, signal);
    return { changed: true };
  } finally {
    await removeOwned(scratch, owner);
  }
}

async function successful(
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal,
) {
  const result = await runProcess({ file, args, cwd, env, signal, timeoutMs: 10 * 60_000 });
  if (result.exitCode !== 0)
    throw new Error(`${file} failed (${result.exitCode}): ${result.stderr}`);
  return result;
}
