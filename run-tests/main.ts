import * as core from "@actions/core";
import { runTestsAction } from "../src/testing/action.js";

export async function main(): Promise<void> {
  await runTestsAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
