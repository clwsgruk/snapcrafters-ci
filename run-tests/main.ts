import * as core from "@actions/core";
import { runTestsAction } from "../src/testing/action.js";

export async function main(): Promise<void> {
  await runTestsAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
