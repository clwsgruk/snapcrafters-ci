import * as core from "@actions/core";
import { runBuildReviewAction } from "../src/review/action.js";

export async function main(): Promise<void> {
  await runBuildReviewAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
