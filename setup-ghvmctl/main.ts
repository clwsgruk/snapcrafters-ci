import * as core from "@actions/core";
import { runGhvmctlSetupAction } from "../src/screenshots/setup.js";

export async function main(): Promise<void> {
  await runGhvmctlSetupAction();
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
