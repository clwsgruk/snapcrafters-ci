import * as core from "@actions/core";
import { runReviewAction } from "../src/review/action.js";

export async function main(): Promise<void> {
  await runReviewAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
