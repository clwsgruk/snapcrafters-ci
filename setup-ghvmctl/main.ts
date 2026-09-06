import * as core from "@actions/core";
import { runGhvmctlSetupAction } from "../src/screenshots/setup.js";

export async function main(): Promise<void> {
  await runGhvmctlSetupAction();
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
