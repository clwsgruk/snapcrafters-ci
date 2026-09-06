import * as core from "@actions/core";
import { runTestingIssueAction } from "../src/testing/action.js";

export async function main(): Promise<void> {
  if (process.env.SNAPCRAFTERS_CI_SMOKE === "1") return;
  await runTestingIssueAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
