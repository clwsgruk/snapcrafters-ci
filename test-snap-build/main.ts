import * as core from "@actions/core";
import { runBuildReviewAction } from "../src/review/action.js";

export async function main(): Promise<void> {
  await runBuildReviewAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
