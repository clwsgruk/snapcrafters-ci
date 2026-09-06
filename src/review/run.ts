import { runProcess, type ProcessResult } from "../runtime/process.js";

export interface ReviewInput {
  snap: string;
  plugs?: string;
  slots?: string;
  classic: boolean;
}

export function reviewArguments(input: ReviewInput): string[] {
  return [
    ...(input.plugs ? ["--plugs", input.plugs] : []),
    ...(input.slots ? ["--slots", input.slots] : []),
    ...(input.classic ? ["--allow-classic"] : []),
    input.snap,
  ];
}

export async function runReview(
  input: ReviewInput,
  cwd: string,
  signal: AbortSignal,
): Promise<ProcessResult> {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? cwd };
  let result = await runProcess({
    file: "snap",
    args: ["list", "review-tools"],
    cwd,
    env,
    signal,
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) {
    result = await runProcess({
      file: "sudo",
      args: ["snap", "install", "review-tools"],
      cwd,
      env,
      signal,
      timeoutMs: 5 * 60_000,
    });
    if (result.exitCode !== 0)
      throw new Error(`Installing review-tools failed (${result.exitCode})`);
  }
  result = await runProcess({
    file: "review-tools.snap-review",
    args: reviewArguments(input),
    cwd,
    env,
    signal,
    timeoutMs: 10 * 60_000,
  });
  if (result.exitCode !== 0) throw new Error(`Snap review failed (${result.exitCode})`);
  return result;
}
