import * as core from "@actions/core";
import { runScreenshotsAction } from "../src/screenshots/action.js";

export async function main(): Promise<void> {
  await runScreenshotsAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
