import * as core from "@actions/core";
import { runReleaseAction } from "../src/release/action.js";

export async function main(): Promise<void> {
  await runReleaseAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
